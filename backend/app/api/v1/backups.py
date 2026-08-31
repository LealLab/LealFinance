"""Authenticated portable backups for the current user."""

from fastapi import APIRouter

from app.api.deps import CurrentUser, DbSession
from app.schemas.backup import (
    BackupArchiveRequest,
    BackupExportRequest,
    BackupExportResponse,
    BackupPreviewResponse,
    BackupRestoreResponse,
)
from app.services import backups as backup_service

router = APIRouter(prefix="/backups", tags=["backups"])


@router.post("/export", response_model=BackupExportResponse)
async def export_backup(
    payload: BackupExportRequest, user: CurrentUser, db: DbSession
) -> BackupExportResponse:
    return await backup_service.export_backup(db, user, encrypted=payload.encrypted)


@router.post("/preview", response_model=BackupPreviewResponse)
async def preview_backup(
    payload: BackupArchiveRequest, user: CurrentUser, db: DbSession
) -> BackupPreviewResponse:
    return await backup_service.preview_backup(db, user, payload.archive, payload.recovery_key)


@router.post("/restore", response_model=BackupRestoreResponse)
async def restore_backup(
    payload: BackupArchiveRequest, user: CurrentUser, db: DbSession
) -> BackupRestoreResponse:
    return await backup_service.restore_backup(db, user, payload.archive, payload.recovery_key)
