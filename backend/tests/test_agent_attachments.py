"""Chat upload validation, ownership, history, and deletion."""

import base64
import io
from contextlib import asynccontextmanager
from uuid import UUID

import httpx
import pymupdf
import pytest
from httpx import AsyncClient
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models.agent_attachment import AgentAttachment
from app.schemas.agent import AgentAttachmentCreate
from app.services.agent_attachments import decode_file
from tests.factories import login_as, make_user
from tests.test_agent_chat import (
    _chat_user,
    _conversation,
    _enable_agents,
    _mock_client_factory,
    _text_body,
)


@pytest.fixture
def _shared_session(db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> None:
    @asynccontextmanager
    async def scope():
        yield db_session

    monkeypatch.setattr("app.services.agent_chat.session_scope", scope)


def _file(name: str, media_type: str, data: bytes) -> dict[str, str]:
    return {"name": name, "media_type": media_type, "data": base64.b64encode(data).decode()}


@pytest.mark.parametrize(
    "name,media_type,data,code",
    [
        ("../a.txt", "text/plain", b"hello", "agents.attachment_invalid"),
        ("a.exe", "text/plain", b"hello", "agents.attachment_unsupported"),
        ("a.txt", "text/plain", b"\xff", "agents.attachment_invalid"),
        ("a.csv", "text/csv", b'"unterminated', "agents.attachment_invalid"),
        ("a.png", "image/png", b"not an image", "agents.attachment_invalid"),
        pytest.param(
            "x" * 252 + ".txt", "text/plain", b"ok", "agents.attachment_invalid", id="long-name"
        ),
        pytest.param(
            "a.txt",
            "text/plain",
            b"x" * (5 * 1024 * 1024 + 1),
            "agents.attachment_limit",
            id="oversize",
        ),
    ],
)
def test_invalid_files(name: str, media_type: str, data: bytes, code: str) -> None:
    with pytest.raises(ValidationAppError) as error:
        decode_file(AgentAttachmentCreate(**_file(name, media_type, data)))
    assert error.value.code == code


def test_pdf_page_limit_and_scanned_page() -> None:
    document = pymupdf.open()
    for _ in range(11):
        document.new_page()
    with pytest.raises(ValidationAppError) as error:
        decode_file(
            AgentAttachmentCreate(**_file("many.pdf", "application/pdf", document.tobytes()))
        )
    assert error.value.code == "agents.attachment_limit"
    document.close()
    scanned = pymupdf.open()
    scanned.new_page()
    assert (
        decode_file(
            AgentAttachmentCreate(**_file("scan.pdf", "application/pdf", scanned.tobytes()))
        )[1]
        == "application/pdf"
    )
    scanned.close()


@pytest.mark.parametrize(
    "format,extension,media_type",
    [("JPEG", "jpg", "image/jpeg"), ("PNG", "png", "image/png"), ("WEBP", "webp", "image/webp")],
)
def test_supported_images(format: str, extension: str, media_type: str) -> None:
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), "red").save(buffer, format=format)
    assert (
        decode_file(
            AgentAttachmentCreate(**_file(f"photo.{extension}", media_type, buffer.getvalue()))
        )[1]
        == media_type
    )


async def test_file_only_history_download_ownership_and_delete(
    client: AsyncClient,
    other_client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    _shared_session: None,
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env")
    await _chat_user(client, db_session, "attachment-owner@example.com")
    conversation = await _conversation(client)
    conversation_id = conversation["id"]

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_text_body("Done"))

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    response = await client.post(
        f"/api/v1/agents/conversations/{conversation_id}/messages",
        json={"attachments": [_file("statement.csv", "text/csv", b"date,amount\n2026-01-01,12")]},
    )
    assert response.status_code == 200, response.text
    detail = (await client.get(f"/api/v1/agents/conversations/{conversation_id}")).json()
    assert detail["title"] == "statement.csv"
    attachment = detail["messages"][0]["attachments"][0]
    assert attachment["name"] == "statement.csv"
    url = f"/api/v1/agents/conversations/{conversation_id}/attachments/{attachment['id']}"
    downloaded = await client.get(url)
    assert downloaded.content == b"date,amount\n2026-01-01,12"
    assert downloaded.headers["x-content-type-options"] == "nosniff"
    assert downloaded.headers["content-disposition"].startswith("attachment;")

    other, password = await make_user(db_session, email="attachment-other@example.com")
    other.ai_chat_enabled = True
    await db_session.commit()
    await login_as(other_client, email=other.email, password=password)
    assert (await other_client.get(url)).status_code == 404

    assert (
        await client.delete(f"/api/v1/agents/conversations/{conversation_id}")
    ).status_code == 204
    assert (
        await db_session.scalar(
            select(AgentAttachment.id).where(AgentAttachment.id == UUID(attachment["id"]))
        )
        is None
    )


async def test_rejected_attachment_does_not_persist_message(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    _shared_session: None,
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env")
    await _chat_user(client, db_session, "attachment-reject@example.com")
    conversation = await _conversation(client)
    url = f"/api/v1/agents/conversations/{conversation['id']}/messages"
    response = await client.post(
        url, json={"attachments": [_file("bad.pdf", "application/pdf", b"bad")]}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "agents.attachment_invalid"
    assert (await client.get(f"/api/v1/agents/conversations/{conversation['id']}")).json()[
        "messages"
    ] == []

    response = await client.post(
        url,
        json={"attachments": [_file(f"{index}.txt", "text/plain", b"ok") for index in range(4)]},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "agents.attachment_limit"


async def test_vision_and_conversation_limit_are_checked_before_persist(
    client: AsyncClient,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    _shared_session: None,
) -> None:
    _enable_agents(monkeypatch, anthropic_api_key="sk-env")
    await _chat_user(client, db_session, "attachment-limits@example.com")
    conversation = await _conversation(client)
    url = f"/api/v1/agents/conversations/{conversation['id']}/messages"
    image = pymupdf.Pixmap(pymupdf.csRGB, (0, 0, 1, 1), 0).tobytes("png")

    async def no_vision(_credential: object) -> bool:
        return False

    monkeypatch.setattr("app.services.agent_chat.chat.supports_images", no_vision)
    response = await client.post(
        url, json={"attachments": [_file("photo.png", "image/png", image)]}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "agents.attachment_vision_required"
    assert (await client.get(f"/api/v1/agents/conversations/{conversation['id']}")).json()[
        "messages"
    ] == []

    monkeypatch.setattr("app.services.agent_chat.agent_attachments.MAX_CONVERSATION_BYTES", 2)
    response = await client.post(
        url, json={"attachments": [_file("small.txt", "text/plain", b"abc")]}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "agents.attachment_limit"

    monkeypatch.setattr("app.services.agent_chat.agent_attachments.MAX_CONVERSATION_BYTES", 5)

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=_text_body("ok"))

    monkeypatch.setattr(httpx, "AsyncClient", _mock_client_factory(handler))
    assert (
        await client.post(url, json={"attachments": [_file("first.txt", "text/plain", b"abc")]})
    ).status_code == 200
    response = await client.post(
        url, json={"attachments": [_file("second.txt", "text/plain", b"xyz")]}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "agents.attachment_limit"
