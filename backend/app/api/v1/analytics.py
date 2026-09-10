"""Read-only ledger analytics endpoints."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession
from app.core.errors import ValidationAppError
from app.schemas.analytics import AccountBalancePointRead, GroupSpendRead, MonthTotalsRead
from app.services import analytics as analytics_service

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/monthly-totals", response_model=list[MonthTotalsRead])
async def get_monthly_totals(
    user: CurrentUser, db: DbSession, date_from: date, date_to: date
) -> list[analytics_service.MonthTotals]:
    return await analytics_service.monthly_totals(db, user.id, date_from=date_from, date_to=date_to)


@router.get("/category-spend", response_model=list[GroupSpendRead])
async def get_category_spend(
    user: CurrentUser, db: DbSession, date_from: date, date_to: date
) -> list[analytics_service.GroupSpend]:
    return await analytics_service.spend_by_category_group(
        db, user.id, date_from=date_from, date_to=date_to
    )


@router.get("/balance-trend", response_model=list[AccountBalancePointRead])
async def get_balance_trend(
    user: CurrentUser,
    db: DbSession,
    months: Annotated[list[str] | None, Query()] = None,
) -> list[analytics_service.AccountBalancePoint]:
    months = months or []
    if len(months) > 36:
        raise ValidationAppError(code="analytics.too_many_months", params={"max": 36})
    if any(analytics_service._MONTH_PATTERN.fullmatch(month) is None for month in months):
        raise ValidationAppError(code="analytics.invalid_month")
    return await analytics_service.account_balance_trend(db, user.id, months=months)
