"""Standalone MCP server for external clients.

External MCP clients (for example, Claude Desktop) authenticate with a token
minted at ``POST /api/v1/agents/mcp-token``. In-app chat does not use this
server; it calls the tool registry in-process.
"""

import json
from contextvars import ContextVar
from typing import Any
from uuid import UUID

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.tools.base import Tool
from mcp.server.fastmcp.utilities.func_metadata import ArgModelBase, FuncMetadata
from pydantic import ConfigDict
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.agents import MCP_TOKEN_TTL_SECONDS, tools
from app.core import crypto
from app.core.db import session_scope
from app.models.user import ROLE_ADMIN, User

_CURRENT_USER: ContextVar[UUID] = ContextVar("mcp_user_id")


class _ToolArguments(ArgModelBase):
    model_config = ConfigDict(arbitrary_types_allowed=True, extra="allow")

    def model_dump_one_level(self) -> dict[str, Any]:
        return dict(self.model_extra or {})


def _make_tool(spec: tools.ToolDef) -> Tool:
    async def run(**arguments: Any) -> Any:
        user_id = _CURRENT_USER.get()
        async with session_scope() as db:
            return await spec.run(db, user_id, arguments)

    return Tool(
        fn=run,
        name=spec.name,
        description=spec.description,
        parameters=spec.schema,
        fn_metadata=FuncMetadata(arg_model=_ToolArguments),
        is_async=True,
    )


mcp = FastMCP(
    name="LealFinance",
    stateless_http=True,
    tools=[_make_tool(spec) for spec in tools.SPECS],
)


@mcp.custom_route("/healthz", methods=["GET"])
async def _healthz(_request: Request) -> PlainTextResponse:
    return PlainTextResponse("ok")


def _bearer_token(headers: list[tuple[bytes, bytes]]) -> str | None:
    for name, value in headers:
        if name.lower() != b"authorization" or value[:7].lower() != b"bearer ":
            continue
        try:
            token = value[7:].decode("ascii")
        except UnicodeDecodeError:
            return None
        return token or None
    return None


async def _chat_allowed(user_id: UUID) -> bool:
    async with session_scope() as db:
        user = await db.get(User, user_id)
    return bool(user and user.is_active and (user.role == ROLE_ADMIN or user.ai_chat_enabled))


async def _send_401(send: Send) -> None:
    body = json.dumps(
        {"error": {"code": "agents.chat_not_allowed", "params": {}}},
        separators=(",", ":"),
    ).encode()
    await send(
        {
            "type": "http.response.start",
            "status": 401,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class _BearerAuth:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope.get("path") == "/healthz":
            await self.app(scope, receive, send)
            return

        token = _bearer_token(scope.get("headers", []))
        user_id = crypto.verify_mcp_token(token, max_age=MCP_TOKEN_TTL_SECONDS) if token else None
        if user_id is None or not await _chat_allowed(user_id):
            await _send_401(send)
            return

        context_token = _CURRENT_USER.set(user_id)
        try:
            await self.app(scope, receive, send)
        finally:
            _CURRENT_USER.reset(context_token)


app = _BearerAuth(mcp.streamable_http_app())
