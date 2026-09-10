"""Read-only SQL aggregations for ledger analytics."""

import re
from calendar import monthrange
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models.account import Account
from app.models.category import Category
from app.models.transaction import (
    TRANSACTION_TYPE_EXPENSE,
    TRANSACTION_TYPE_INCOME,
    Transaction,
)
from app.services import accounts, budgets, ownership
from app.services.exchange_rates import get_exchange_rate

_MONEY_QUANTUM = Decimal("0.0001")
_MONTH_PATTERN = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


@dataclass(frozen=True, slots=True)
class GroupSpend:
    group_id: UUID
    currency: str
    total: Decimal


@dataclass(frozen=True, slots=True)
class MonthTotals:
    month: str
    currency: str
    income: Decimal
    expense: Decimal
    net: Decimal


@dataclass(frozen=True, slots=True)
class AccountBalancePoint:
    month: str
    account_id: UUID
    currency: str
    balance: Decimal


@dataclass(frozen=True, slots=True)
class BudgetStatus:
    group_id: UUID
    currency: str
    budget: Decimal | None
    spent: Decimal
    remaining: Decimal | None


def _round_money(value: Decimal) -> Decimal:
    return value.quantize(_MONEY_QUANTUM, rounding=ROUND_HALF_UP)


async def spend_by_category_group(
    db: AsyncSession,
    user_id: UUID,
    *,
    date_from: date,
    date_to: date,
    currency: str | None = None,
) -> list[GroupSpend]:
    effective = func.coalesce(Transaction.conversion_amount, Transaction.amount)
    settlement_currency = func.coalesce(
        Transaction.conversion_currency, Transaction.currency
    ).label("currency")
    query = (
        select(
            Category.group_id,
            settlement_currency,
            func.sum(effective).label("total"),
        )
        .join(
            Category,
            and_(
                Category.id == Transaction.category_id,
                Category.user_id == user_id,
            ),
        )
        .where(
            Transaction.type == TRANSACTION_TYPE_EXPENSE,
            Transaction.date.between(date_from, date_to),
            Transaction.user_id == user_id,
        )
        .group_by(Category.group_id, settlement_currency)
        .order_by(Category.group_id, settlement_currency)
    )

    result = await db.execute(query)
    rows = list(result)
    if currency is None:
        return [
            GroupSpend(
                group_id=row.group_id,
                currency=row.currency,
                total=Decimal(row.total),
            )
            for row in rows
        ]

    totals: dict[UUID, Decimal] = {}
    for row in rows:
        total = Decimal(row.total)
        if row.currency != currency:
            total *= (
                await get_exchange_rate(
                    db,
                    row.currency,
                    currency,
                    user_id=user_id,
                    as_of=date_to,
                )
            ).rate
        totals[row.group_id] = totals.get(row.group_id, Decimal(0)) + total

    return [
        GroupSpend(group_id=group_id, currency=currency, total=_round_money(total))
        for group_id, total in totals.items()
    ]


async def monthly_totals(
    db: AsyncSession,
    user_id: UUID,
    *,
    date_from: date,
    date_to: date,
    currency: str | None = None,
) -> list[MonthTotals]:
    effective = func.coalesce(Transaction.conversion_amount, Transaction.amount)
    month_expression = func.to_char(Transaction.date, "YYYY-MM")
    settlement_currency = func.coalesce(
        Transaction.conversion_currency, Transaction.currency
    ).label("currency")
    query = (
        select(
            month_expression.label("month"),
            Transaction.type,
            settlement_currency,
            func.sum(effective).label("total"),
        )
        .where(
            Transaction.type.in_((TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_EXPENSE)),
            Transaction.date.between(date_from, date_to),
            Transaction.user_id == user_id,
        )
        .group_by(month_expression, Transaction.type, settlement_currency)
    )

    result = await db.execute(query)
    native_totals: dict[tuple[str, str], list[Decimal]] = {}
    for row in result:
        totals = native_totals.setdefault((row.month, row.currency), [Decimal(0), Decimal(0)])
        if row.type == TRANSACTION_TYPE_INCOME:
            totals[0] += Decimal(row.total)
        else:
            totals[1] += Decimal(row.total)

    if currency is None:
        return [
            MonthTotals(
                month=month,
                currency=row_currency,
                income=totals[0],
                expense=totals[1],
                net=totals[0] - totals[1],
            )
            for (month, row_currency), totals in sorted(native_totals.items())
        ]

    converted_totals: dict[str, list[Decimal]] = {}
    for (month, row_currency), totals in native_totals.items():
        rate = Decimal(1)
        if row_currency != currency:
            rate = (
                await get_exchange_rate(
                    db,
                    row_currency,
                    currency,
                    user_id=user_id,
                    as_of=date_to,
                )
            ).rate
        converted = converted_totals.setdefault(month, [Decimal(0), Decimal(0)])
        converted[0] += totals[0] * rate
        converted[1] += totals[1] * rate

    output: list[MonthTotals] = []
    for month in sorted(converted_totals):
        income = _round_money(converted_totals[month][0])
        expense = _round_money(converted_totals[month][1])
        output.append(
            MonthTotals(
                month=month,
                currency=currency,
                income=income,
                expense=expense,
                net=income - expense,
            )
        )
    return output


async def account_balance_trend(
    db: AsyncSession, user_id: UUID, *, months: list[str]
) -> list[AccountBalancePoint]:
    if not months:
        return []

    accounts_owned = list(await ownership.list_owned(db, Account, user_id))
    if not accounts_owned:
        return []

    first_month = date.fromisoformat(f"{months[0]}-01")
    last_month = date.fromisoformat(f"{months[-1]}-01")
    last_month_end = date(
        last_month.year,
        last_month.month,
        monthrange(last_month.year, last_month.month)[1],
    )
    legs = accounts._account_leg_deltas(user_id).subquery()

    history_query = (
        select(legs.c.account_id, func.sum(legs.c.delta).label("delta"))
        .where(legs.c.date < first_month)
        .group_by(legs.c.account_id)
    )
    history_result = await db.execute(history_query)
    history_by_account = {row.account_id: Decimal(row.delta) for row in history_result}

    month_expression = func.to_char(legs.c.date, "YYYY-MM")
    month_query = (
        select(
            legs.c.account_id,
            month_expression.label("month"),
            func.sum(legs.c.delta).label("delta"),
        )
        .where(legs.c.date.between(first_month, last_month_end))
        .group_by(legs.c.account_id, month_expression)
    )
    month_result = await db.execute(month_query)
    delta_by_account_month = {
        (row.account_id, row.month): Decimal(row.delta) for row in month_result
    }

    running = {
        account.id: account.opening_balance + history_by_account.get(account.id, Decimal(0))
        for account in accounts_owned
    }
    points: list[AccountBalancePoint] = []
    for month in months:
        for account in accounts_owned:
            running[account.id] += delta_by_account_month.get((account.id, month), Decimal(0))
            points.append(
                AccountBalancePoint(
                    month=month,
                    account_id=account.id,
                    currency=account.currency,
                    balance=running[account.id],
                )
            )
    return points


async def budget_status(
    db: AsyncSession,
    user_id: UUID,
    *,
    month: str,
) -> list[BudgetStatus]:
    if _MONTH_PATTERN.fullmatch(month) is None:
        raise ValidationAppError(code="analytics.invalid_month")

    year = int(month[:4])
    month_number = int(month[5:])
    date_from = date(year, month_number, 1)
    date_to = date(year, month_number, monthrange(year, month_number)[1])

    spend = await spend_by_category_group(
        db,
        user_id,
        date_from=date_from,
        date_to=date_to,
    )
    user_budgets = [
        budget for budget in await budgets.list_budgets(db, user_id) if budget.month == month
    ]

    statuses: dict[tuple[UUID, str], BudgetStatus] = {
        (row.group_id, row.currency): BudgetStatus(
            group_id=row.group_id,
            currency=row.currency,
            budget=None,
            spent=row.total,
            remaining=None,
        )
        for row in spend
    }
    for budget in user_budgets:
        key = (budget.group_id, budget.currency)
        existing = statuses.get(key)
        spent = existing.spent if existing is not None else Decimal(0)
        statuses[key] = BudgetStatus(
            group_id=budget.group_id,
            currency=budget.currency,
            budget=budget.amount,
            spent=spent,
            remaining=budget.amount - spent,
        )

    return sorted(statuses.values(), key=lambda row: (str(row.group_id), row.currency))
