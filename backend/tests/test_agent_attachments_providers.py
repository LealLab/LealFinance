"""Provider request shapes for persisted chat attachments."""

from unittest.mock import AsyncMock

import httpx
import pymupdf
import pytest

from app.agents.chat import (
    _anthropic_messages,
    _codex_input,
    _compatible_messages,
    supports_images,
)
from app.agents.credentials import ResolvedCredential
from app.agents.events import Attachment, Turn


def _credential(provider: str, model: str, base_url: str | None = None) -> ResolvedCredential:
    return ResolvedCredential(provider, "none", None, base_url, model, None, None, "user")


def test_image_and_text_request_shapes() -> None:
    turn = Turn(
        role="user",
        attachments=(
            Attachment("receipt.png", "image/png", b"png"),
            Attachment("statement.csv", "text/csv", b"date,amount\n2026-01-01,12"),
        ),
    )
    anthropic = _anthropic_messages([turn])[0]["content"]
    assert anthropic[1]["source"] == {"type": "base64", "media_type": "image/png", "data": "cG5n"}
    assert "statement.csv" in anthropic[-1]["text"]
    openai = _codex_input([turn])[0]["content"]
    assert openai[1] == {"type": "input_image", "image_url": "data:image/png;base64,cG5n"}
    compatible = _compatible_messages([turn], "system")[1]["content"]
    assert compatible[1] == {
        "type": "image_url",
        "image_url": {"url": "data:image/png;base64,cG5n"},
    }


def test_pdf_includes_page_text_and_rendered_image() -> None:
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 72), "Invoice total 12")
    pdf = document.tobytes()
    document.close()
    turn = Turn(role="user", attachments=(Attachment("invoice.pdf", "application/pdf", pdf),))
    content = _codex_input([turn])[0]["content"]
    assert "Invoice total 12" in content[0]["text"]
    assert content[1]["image_url"].startswith("data:image/png;base64,")


@pytest.mark.parametrize("model,expected", [("llama3.1", False), ("qwen3-vl:8b", True)])
async def test_ollama_vision_capability(
    monkeypatch: pytest.MonkeyPatch, model: str, expected: bool
) -> None:
    response = httpx.Response(
        200,
        json={"capabilities": ["completion", "vision"] if expected else ["completion"]},
        request=httpx.Request("POST", "http://localhost/api/show"),
    )
    client = AsyncMock()
    client.post.return_value = response
    client.__aenter__.return_value = client
    client.__aexit__.return_value = None
    monkeypatch.setattr(httpx, "AsyncClient", lambda **_kwargs: client)
    assert await supports_images(_credential("ollama", model, "http://localhost")) is expected
    assert client.post.call_args.kwargs["json"] == {"model": model}


async def test_known_nonvision_model_is_rejected() -> None:
    assert not await supports_images(_credential("openai", "gpt-3.5-turbo"))
    assert not await supports_images(_credential("anthropic", "unknown"))
    assert not await supports_images(_credential("anthropic", "claude-2.1"))
