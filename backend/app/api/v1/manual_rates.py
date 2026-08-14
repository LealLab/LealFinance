"""Manual exchange-rate override CRUD - see
app/services/exchange_rates.py for the precedence these participate in."""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.core.errors import ValidationAppError
from app.models.manual_rate import ManualRate
from app.schemas.manual_rate import ManualRateRead, ManualRateUpsert
from app.services import manual_rates as manual_rates_service

router = APIRouter(prefix="/manual-rates", tags=["manual-rates"])


def _parse_pair(pair: str) -> tuple[str, str]:
    parts = pair.upper().split("_")
    if len(parts) != 2 or not all(len(part) == 3 for part in parts):
        raise ValidationAppError(code="manual_rate.invalid_pair", params={"pair": pair})
    return parts[0], parts[1]


@router.get("", response_model=list[ManualRateRead])
async def list_manual_rates(user: CurrentUser, db: DbSession) -> list[ManualRate]:
    return await manual_rates_service.list_manual_rates(db, user.id)


@router.put("/{pair}/{as_of}", response_model=ManualRateRead)
async def upsert_manual_rate(
    pair: str, as_of: date, payload: ManualRateUpsert, user: CurrentUser, db: DbSession
) -> ManualRate:
    base_code, quote_code = _parse_pair(pair)
    return await manual_rates_service.upsert_manual_rate(
        db, user.id, base_code, quote_code, as_of, payload.rate
    )


@router.delete("/{manual_rate_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_manual_rate(manual_rate_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await manual_rates_service.delete_manual_rate(db, user.id, manual_rate_id)
