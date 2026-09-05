"""User-owned Pluggy credentials and item lifecycle."""

from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.open_finance import PluggyAccount, PluggyItem
from app.schemas.open_finance import (
    ConnectTokenRead,
    ConnectTokenRequest,
    PluggyAccountRead,
    PluggyCredentialStatusRead,
    PluggyCredentialWrite,
    PluggyItemCreate,
    PluggyItemRead,
    SyncResultRead,
)
from app.services import open_finance, open_finance_sync, pluggy_credentials

router = APIRouter(prefix="/open-finance", tags=["open-finance"])


@router.get("/credentials", response_model=PluggyCredentialStatusRead)
async def get_credentials(user: CurrentUser, db: DbSession) -> PluggyCredentialStatusRead:
    return await pluggy_credentials.status(db, user.id)


@router.put("/credentials", response_model=PluggyCredentialStatusRead)
async def put_credentials(
    payload: PluggyCredentialWrite, user: CurrentUser, db: DbSession
) -> PluggyCredentialStatusRead:
    return await pluggy_credentials.link(
        db, user.id, payload.client_id, payload.client_secret, payload.environment
    )


@router.delete("/credentials", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credentials(user: CurrentUser, db: DbSession) -> None:
    await pluggy_credentials.unlink(db, user.id)


@router.post("/connect-token", response_model=ConnectTokenRead)
async def post_connect_token(
    user: CurrentUser, db: DbSession, payload: ConnectTokenRequest | None = None
) -> ConnectTokenRead:
    token = await open_finance.create_connect_token(
        db, user.id, payload.item_id if payload is not None else None
    )
    return ConnectTokenRead(access_token=token)


@router.get("/items", response_model=list[PluggyItemRead])
async def list_items(user: CurrentUser, db: DbSession) -> list[PluggyItem]:
    return await open_finance.list_items(db, user.id)


@router.post("/items", response_model=PluggyItemRead, status_code=status.HTTP_201_CREATED)
async def register_item(payload: PluggyItemCreate, user: CurrentUser, db: DbSession) -> PluggyItem:
    return await open_finance.register_item(db, user.id, payload.external_id)


@router.post("/items/{item_id}/sync", response_model=SyncResultRead)
async def sync_item(item_id: UUID, user: CurrentUser, db: DbSession) -> SyncResultRead:
    result = await open_finance_sync.sync_item(db, user.id, item_id)
    return SyncResultRead(
        transactions_imported=result.transactions_imported,
        accounts_synced=result.accounts_synced,
        error=result.error,
    )


@router.get("/items/{item_id}", response_model=PluggyItemRead)
async def get_item(item_id: UUID, user: CurrentUser, db: DbSession) -> PluggyItem:
    return await open_finance.get_item(db, user.id, item_id)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def disconnect_item(
    item_id: UUID,
    user: CurrentUser,
    db: DbSession,
    mode: open_finance.DisconnectMode = "keep",
) -> None:
    await open_finance.disconnect_item(db, user.id, item_id, mode)


@router.get("/items/{item_id}/accounts", response_model=list[PluggyAccountRead])
async def list_item_accounts(
    item_id: UUID, user: CurrentUser, db: DbSession
) -> list[PluggyAccount]:
    return await open_finance.list_accounts(db, user.id, item_id)
