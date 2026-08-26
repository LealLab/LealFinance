"""User-owned market-data credential management."""

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.investment import (
    MarketDataCredentialStatusRead,
    MarketDataCredentialUpdate,
)
from app.services import market_data_credentials

router = APIRouter(prefix="/market-data", tags=["market-data"])


@router.get("/credentials", response_model=list[MarketDataCredentialStatusRead])
async def list_credentials(
    user: CurrentUser, db: DbSession
) -> list[MarketDataCredentialStatusRead]:
    return await market_data_credentials.list_status(db, user.id)


@router.put("/credentials/{provider}", response_model=MarketDataCredentialStatusRead)
async def link_credential(
    provider: str,
    payload: MarketDataCredentialUpdate,
    user: CurrentUser,
    db: DbSession,
) -> MarketDataCredentialStatusRead:
    return await market_data_credentials.link(db, user.id, provider, payload.api_key)


@router.delete("/credentials/{provider}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_credential(provider: str, user: CurrentUser, db: DbSession) -> None:
    await market_data_credentials.unlink(db, user.id, provider)
