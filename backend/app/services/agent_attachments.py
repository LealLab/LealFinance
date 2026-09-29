"""Decode and validate chat files before a message is persisted."""

import base64
import binascii
import csv
import io
from pathlib import PurePath

import pymupdf
from PIL import Image
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models.agent_attachment import AgentAttachment
from app.models.agent_message import AgentMessage
from app.schemas.agent import AgentAttachmentCreate

MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_CONVERSATION_BYTES = 10 * 1024 * 1024
MAX_PDF_PAGES = 10

MEDIA_TYPES = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".md": "text/plain",
    ".csv": "text/csv",
}


def decode_file(file: AgentAttachmentCreate) -> tuple[str, str, bytes]:
    name = file.name.strip()
    if (
        not name
        or len(name) > 255
        or name in {".", ".."}
        or any(char in name for char in ("/", "\\", "\0", "\r", "\n"))
        or any(ord(char) < 32 or ord(char) == 127 for char in name)
    ):
        raise ValidationAppError(code="agents.attachment_invalid")
    media_type = MEDIA_TYPES.get(PurePath(name).suffix.lower())
    if media_type is None or file.media_type != media_type:
        raise ValidationAppError(code="agents.attachment_unsupported", params={"name": name})
    if len(file.data) > ((MAX_FILE_BYTES + 2) // 3) * 4:
        raise ValidationAppError(code="agents.attachment_limit", params={"name": name})
    try:
        data = base64.b64decode(file.data, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValidationAppError(code="agents.attachment_invalid", params={"name": name}) from exc
    if not data or len(data) > MAX_FILE_BYTES:
        raise ValidationAppError(code="agents.attachment_limit", params={"name": name})

    if media_type.startswith("image/"):
        signature_ok = (
            (media_type == "image/jpeg" and data.startswith(b"\xff\xd8\xff"))
            or (media_type == "image/png" and data.startswith(b"\x89PNG\r\n\x1a\n"))
            or (media_type == "image/webp" and data.startswith(b"RIFF") and data[8:12] == b"WEBP")
        )
        if not signature_ok:
            raise ValidationAppError(code="agents.attachment_invalid", params={"name": name})
        try:
            with Image.open(io.BytesIO(data)) as image:
                expected = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
                if (
                    image.format != expected[media_type]
                    or image.width < 1
                    or image.height < 1
                    or image.width * image.height > 25_000_000
                ):
                    raise ValueError("invalid image")
                image.load()
        except Exception as exc:
            raise ValidationAppError(
                code="agents.attachment_invalid", params={"name": name}
            ) from exc
    elif media_type == "application/pdf":
        try:
            with pymupdf.open(stream=data, filetype="pdf") as pdf:  # type: ignore[no-untyped-call]
                if pdf.page_count > MAX_PDF_PAGES:
                    raise ValidationAppError(code="agents.attachment_limit", params={"name": name})
                if pdf.is_encrypted or pdf.page_count < 1:
                    raise ValueError("invalid PDF pages")
                for page in pdf:
                    page.get_text()
        except ValidationAppError:
            raise
        except Exception as exc:
            raise ValidationAppError(
                code="agents.attachment_invalid", params={"name": name}
            ) from exc
    else:
        try:
            content = data.decode("utf-8-sig")
            if not content.strip() or "\0" in content:
                raise ValueError("empty or binary text")
            if media_type == "text/csv":
                list(csv.reader(io.StringIO(content), strict=True))
        except (UnicodeError, ValueError, csv.Error) as exc:
            raise ValidationAppError(
                code="agents.attachment_invalid", params={"name": name}
            ) from exc
    return name, media_type, data


async def conversation_bytes(db: AsyncSession, conversation_id: object) -> int:
    result = await db.scalar(
        select(func.coalesce(func.sum(AgentAttachment.size), 0))
        .join(AgentMessage, AgentMessage.id == AgentAttachment.message_id)
        .where(AgentMessage.conversation_id == conversation_id)
    )
    return int(result or 0)
