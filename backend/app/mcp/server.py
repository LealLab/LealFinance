"""Standalone MCP server for external clients.

External MCP clients (for example, Claude Desktop) authenticate with a token
minted at ``POST /api/v1/agents/mcp-tokens``. Tokens are revocable and carry a
scope: ``read`` tokens can call only read tools, ``write`` tokens all of them.
In-app chat does not use this server; it calls the tool registry in-process.
"""

import json
from contextvars import ContextVar
from typing import Any
from uuid import UUID, uuid4

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.server.fastmcp.tools.base import Tool
from mcp.server.fastmcp.utilities.func_metadata import ArgModelBase, FuncMetadata
from pydantic import ConfigDict
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.agents import tools
from app.core.config import get_settings
from app.core.db import session_scope
from app.core.logging import client_ip_var, configure_logging
from app.models.mcp_token import MCP_SCOPE_READ, MCP_SCOPE_WRITE
from app.services import change_journal, mcp_tokens

# Standalone process: the API's startup (app/main.py) never runs here.
configure_logging(get_settings().log_level)

_CURRENT_USER: ContextVar[UUID] = ContextVar("mcp_user_id")
_CURRENT_SCOPE: ContextVar[str] = ContextVar("mcp_scope")


class _ToolArguments(ArgModelBase):
    model_config = ConfigDict(arbitrary_types_allowed=True, extra="allow")

    def model_dump_one_level(self) -> dict[str, Any]:
        return dict(self.model_extra or {})


def _make_tool(spec: tools.ToolDef) -> Tool:
    async def run(**arguments: Any) -> Any:
        user_id = _CURRENT_USER.get()
        if spec.writes and _CURRENT_SCOPE.get() != MCP_SCOPE_WRITE:
            raise ToolError(
                f"mcp.read_only_token: this token is read-only and cannot call {spec.name}. "
                "Create a write-scope token under Administration -> AI providers."
            )
        # MCP has no conversation, so each call is its own undo group.
        async with (
            session_scope() as db,
            change_journal.journaling(db, call_id=f"mcp:{uuid4()}"),
        ):
            return await spec.run(db, user_id, arguments)

    return Tool(
        fn=run,
        name=spec.name,
        description=spec.description,
        parameters=spec.schema,
        fn_metadata=FuncMetadata(arg_model=_ToolArguments),
        is_async=True,
    )


class _ScopedFastMCP(FastMCP):
    async def list_tools(self) -> Any:
        """A read token is not even shown the write tools (calls are refused too)."""
        listed = await super().list_tools()
        if _CURRENT_SCOPE.get(MCP_SCOPE_READ) == MCP_SCOPE_WRITE:
            return listed
        return [tool for tool in listed if not tools.SPEC_BY_NAME[tool.name].writes]


mcp = _ScopedFastMCP(
    name="LealFinance",
    stateless_http=True,
    # Writes are exposed too: the MCP client confirms them in its own host UI, and
    # every call is journaled so the assistant can undo it (see change_journal).
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


async def _send_error(send: Send, status: int, code: str) -> None:
    body = json.dumps({"error": {"code": code, "params": {}}}, separators=(",", ":")).encode()
    await send(
        {
            "type": "http.response.start",
            "status": status,
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

        # Same switch as the REST router: a token minted earlier must not keep
        # working against an instance that has turned the agents off.
        if not get_settings().agents_enabled:
            await _send_error(send, 404, "agents.disabled")
            return

        client = scope.get("client")
        ip_token = client_ip_var.set(client[0] if client else None)
        try:
            raw = _bearer_token(scope.get("headers", []))
            async with session_scope() as db:
                row = await mcp_tokens.authenticate(db, raw) if raw else None
            if row is None:
                await _send_error(send, 401, "agents.chat_not_allowed")
                return

            user_token = _CURRENT_USER.set(row.user_id)
            scope_token = _CURRENT_SCOPE.set(row.scope)
            try:
                await self.app(scope, receive, send)
            finally:
                _CURRENT_SCOPE.reset(scope_token)
                _CURRENT_USER.reset(user_token)
        finally:
            client_ip_var.reset(ip_token)


app = _BearerAuth(mcp.streamable_http_app())
