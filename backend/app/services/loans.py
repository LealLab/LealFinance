"""Loan CRUD, installment amortization, and payment recording.

`installment_amount` is derived here from `amount_borrowed + fees`,
`interest_rate` and `installment_count` and recomputed on every write - a
client-supplied value is ignored. `record_payment` builds an ordinary
expense `TransactionCreate` carrying the loan's `category_id` and
`loan_id` and delegates to app/services/transactions.py verbatim, so the
same shape and cross-currency validation applies. "Installments paid" is
COUNT(transactions WHERE loan_id), never a stored cursor.

The frontend has a twin of the amortization formula in
domain/calc/loans.ts (kept in lockstep the way domain/calc/recurrence.ts
mirrors app/services/recurrence.py); both are covered by fixtures that use
the same inputs.
"""

from datetime import date as date_type
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models.account import Account
from app.models.category import CATEGORY_KIND_EXPENSE, Category
from app.models.loan import Loan
from app.models.transaction import TRANSACTION_TYPE_EXPENSE, Transaction
from app.schemas.loan import LoanCreate, LoanPaymentCreate, LoanUpdate
from app.schemas.transaction import TransactionCreate
from app.services import ownership
from app.services import transactions as transactions_service
from app.services.currencies import get_active_currency

_CENTS = Decimal("0.0001")


def compute_installment_amount(
    *,
    amount_borrowed: Decimal,
    fees: Decimal,
    interest_rate: Decimal,
    rate_period: str,
    installment_count: int,
) -> Decimal:
    """Fixed monthly installment for a loan of ``amount_borrowed + fees``
    financed over ``installment_count`` equal monthly payments.

    ``interest_rate`` is a percent. A ``rate_period`` of ``"monthly"`` uses
    it directly as the monthly rate; ``"annual"`` divides by 12 (the
    nominal-rate convention). A zero rate is straight-line division.
    Result is quantized to 4 decimal places (NUMERIC(19,4)).
    """
    principal = amount_borrowed + fees
    n = installment_count
    monthly_rate = interest_rate / (Decimal(100) if rate_period == "monthly" else Decimal(1200))

    if monthly_rate == 0:
        raw = principal / Decimal(n)
    else:
        factor = (Decimal(1) + monthly_rate) ** n
        raw = principal * monthly_rate * factor / (factor - Decimal(1))

    return raw.quantize(_CENTS, rounding=ROUND_HALF_UP)


async def installments_paid(db: AsyncSession, loan_id: UUID) -> int:
    """How many installments have been recorded - COUNT(transactions WHERE
    loan_id). This is the single source of truth for loan progress; there
    is no stored cursor."""
    result = await db.scalar(
        select(func.count()).select_from(Transaction).where(Transaction.loan_id == loan_id)
    )
    return int(result or 0)


async def _validate_category(db: AsyncSession, user_id: UUID, category_id: UUID) -> None:
    category = await ownership.get_owned(db, Category, category_id, user_id)
    if category.kind != CATEGORY_KIND_EXPENSE:
        raise ValidationAppError(code="loan.category_not_expense")


async def _validate_payment_account(
    db: AsyncSession, user_id: UUID, account_id: UUID, currency: str
) -> Account:
    account = await ownership.get_owned(db, Account, account_id, user_id)
    if account.archived:
        raise ValidationAppError(code="loan.payment_account_archived")
    if account.currency != currency:
        raise ValidationAppError(code="loan.account_currency_mismatch")
    return account


async def _validate_shape(
    db: AsyncSession,
    user_id: UUID,
    *,
    currency: str,
    category_id: UUID,
    auto_post: bool,
    payment_account_id: UUID | None,
) -> None:
    await get_active_currency(db, currency)
    await _validate_category(db, user_id, category_id)
    if auto_post and payment_account_id is None:
        raise ValidationAppError(code="loan.auto_post_requires_account")
    if payment_account_id is not None:
        await _validate_payment_account(db, user_id, payment_account_id, currency)


async def list_loans(db: AsyncSession, user_id: UUID) -> list[Loan]:
    loans = list(await ownership.list_owned(db, Loan, user_id))
    for loan in loans:
        loan.installments_paid = await installments_paid(db, loan.id)
    return loans


async def get_loan(db: AsyncSession, user_id: UUID, loan_id: UUID) -> Loan:
    loan = await ownership.get_owned(db, Loan, loan_id, user_id)
    loan.installments_paid = await installments_paid(db, loan.id)
    return loan


async def create_loan(db: AsyncSession, user_id: UUID, data: LoanCreate) -> Loan:
    await _validate_shape(
        db,
        user_id,
        currency=data.currency,
        category_id=data.category_id,
        auto_post=data.auto_post,
        payment_account_id=data.payment_account_id,
    )

    values = data.model_dump()
    values["installment_amount"] = compute_installment_amount(
        amount_borrowed=data.amount_borrowed,
        fees=data.fees,
        interest_rate=data.interest_rate,
        rate_period=data.rate_period,
        installment_count=data.installment_count,
    )
    loan = Loan(user_id=user_id, **values)
    db.add(loan)
    await db.commit()
    await db.refresh(loan)
    loan.installments_paid = 0
    return loan


async def update_loan(db: AsyncSession, user_id: UUID, loan_id: UUID, data: LoanUpdate) -> Loan:
    loan = await ownership.get_owned(db, Loan, loan_id, user_id)
    changes = data.model_dump(exclude_unset=True)

    await _validate_shape(
        db,
        user_id,
        currency=changes.get("currency", loan.currency),
        category_id=changes.get("category_id", loan.category_id),
        auto_post=changes.get("auto_post", loan.auto_post),
        payment_account_id=changes.get("payment_account_id", loan.payment_account_id),
    )

    for field, value in changes.items():
        setattr(loan, field, value)

    loan.installment_amount = compute_installment_amount(
        amount_borrowed=loan.amount_borrowed,
        fees=loan.fees,
        interest_rate=loan.interest_rate,
        rate_period=loan.rate_period,
        installment_count=loan.installment_count,
    )

    await db.commit()
    await db.refresh(loan)
    loan.installments_paid = await installments_paid(db, loan.id)
    return loan


async def set_loan_archived(db: AsyncSession, user_id: UUID, loan_id: UUID, archived: bool) -> Loan:
    loan = await ownership.get_owned(db, Loan, loan_id, user_id)
    loan.archived = archived
    await db.commit()
    await db.refresh(loan)
    loan.installments_paid = await installments_paid(db, loan.id)
    return loan


async def record_payment(
    db: AsyncSession, user_id: UUID, loan_id: UUID, data: LoanPaymentCreate, *, today: date_type
) -> Transaction:
    """Post one installment as an ordinary expense transaction carrying the
    loan's category and `loan_id`. Rejected once every installment is
    already paid."""
    loan = await ownership.get_owned(db, Loan, loan_id, user_id)

    paid = await installments_paid(db, loan.id)
    if paid >= loan.installment_count:
        raise ValidationAppError(code="loan.fully_paid")

    account_id = data.account_id or loan.payment_account_id
    if account_id is None:
        raise ValidationAppError(code="loan.payment_account_required")

    payload = TransactionCreate(
        type=TRANSACTION_TYPE_EXPENSE,
        date=data.date or today,
        amount=data.amount or loan.installment_amount,
        currency=loan.currency,
        account_id=account_id,
        category_id=loan.category_id,
        description=data.description or f"{loan.name} {paid + 1}/{loan.installment_count}",
        loan_id=loan.id,
    )
    return await transactions_service.create_transaction(db, user_id, payload)
