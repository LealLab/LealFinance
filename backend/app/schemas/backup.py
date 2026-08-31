"""Portable backup API contracts."""

from typing import Any

from pydantic import BaseModel, Field


class BackupExportRequest(BaseModel):
    encrypted: bool = False


class BackupArchiveRequest(BaseModel):
    archive: object
    recovery_key: str | None = None


class BackupWarning(BaseModel):
    code: str
    params: dict[str, Any] = Field(default_factory=dict)


class BackupExportResponse(BaseModel):
    filename: str
    archive: dict[str, Any]
    recovery_key: str | None


class BackupPreviewResponse(BaseModel):
    source_app_version: str
    exported_at: str
    encrypted: bool
    counts: dict[str, int]
    warnings: list[BackupWarning]


class BackupRestoreResponse(BaseModel):
    counts: dict[str, int]
    warnings: list[BackupWarning]
