"""Loan CRUD, installment amortization, and payment recording.

`installment_amount` is either the optional contracted value or the estimate
derived here from principal, rate, and term. Payments reuse Transaction's
installment metadata, so advances can settle the end of the schedule without
pretending the next installments were paid.

The frontend has a twin of the amortization formula in
domain/calc/loans.ts (kept in lockstep the way domain/calc/recurrence.ts
mirrors app/services/recurrence.py); both are covered by fixtures that use
the same inputs.
"""

from datetime import date as date_type
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum
from uuid import UUID

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError, ValidationAppError
from app.models.account import Account
from app.models.category import CATEGORY_KIND_EXPENSE, Category
from app.models.loan import Loan
from app.models.transaction import TRANSACTION_TYPE_EXPENSE, Transaction
from app.schemas.loan import LoanAdvanceCreate, LoanCreate, LoanPaymentCreate, LoanUpdate
from app.schemas.transaction import TransactionCreate
from app.services import ownership
from app.services import transactions as transactions_service
from app.services.currencies import get_active_currency
from app.services.recurrence import add_months_clamped

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


def installment_due_date(loan: Loan, installment_number: int) -> date_type:
    return add_months_clamped(loan.first_payment_date, installment_number - 1)


def discounted_installment_amount(
    loan: Loan, installment_number: int, payment_date: date_type
) -> Decimal:
    """Present value of one installment using a 30-day compound month."""
    due_date = installment_due_date(loan, installment_number)
    days_early = (due_date - payment_date).days
    monthly_rate = loan.interest_rate / (
        Decimal(100) if loan.rate_period == "monthly" else Decimal(1200)
    )
    if days_early <= 0 or monthly_rate == 0:
        return loan.installment_amount
    raw = loan.installment_amount / (
        (Decimal(1) + monthly_rate) ** (Decimal(days_early) / Decimal(30))
    )
    return raw.quantize(_CENTS, rounding=ROUND_HALF_UP)


async def paid_installment_numbers(db: AsyncSession, loan_id: UUID) -> set[int]:
    result = await db.scalars(
        select(Transaction.installment_number).where(
            Transaction.loan_id == loan_id,
            Transaction.installment_number.is_not(None),
        )
    )
    return {int(number) for number in result.all() if number is not None}


async def installments_paid(db: AsyncSession, loan_id: UUID) -> int:
    """How many numbered installments have been recorded for a loan."""
    result = await db.scalar(
        select(func.count(Transaction.installment_number)).where(Transaction.loan_id == loan_id)
    )
    return int(result or 0)


def next_unpaid_installment_number(loan: Loan, paid: set[int]) -> int | None:
    return next(
        (number for number in range(1, loan.installment_count + 1) if number not in paid),
        None,
    )


async def _get_owned_for_update(db: AsyncSession, user_id: UUID, loan_id: UUID) -> Loan:
    loan = await db.scalar(
        ownership.owned(Loan, user_id).where(Loan.id == loan_id).with_for_update()
    )
    if loan is None:
        raise NotFoundError(code="loan.not_found", params={"id": str(loan_id)})
    return loan


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
    values["installment_amount"] = (
        data.contracted_installment_amount
        if data.contracted_installment_amount is not None
        else compute_installment_amount(
            amount_borrowed=data.amount_borrowed,
            fees=data.fees,
            interest_rate=data.interest_rate,
            rate_period=data.rate_period,
            installment_count=data.installment_count,
        )
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
    paid_numbers = await paid_installment_numbers(db, loan.id)
    new_count = changes.get("installment_count", loan.installment_count)
    if paid_numbers and new_count < max(paid_numbers):
        raise ValidationAppError(code="loan.installment_count_below_paid")

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

    loan.installment_amount = (
        loan.contracted_installment_amount
        if loan.contracted_installment_amount is not None
        else compute_installment_amount(
            amount_borrowed=loan.amount_borrowed,
            fees=loan.fees,
            interest_rate=loan.interest_rate,
            rate_period=loan.rate_period,
            installment_count=loan.installment_count,
        )
    )
    if "installment_count" in changes:
        await db.execute(
            update(Transaction)
            .where(Transaction.loan_id == loan.id)
            .values(installment_count=loan.installment_count)
        )

    await db.commit()
    await db.refresh(loan)
    loan.installments_paid = await installments_paid(db, loan.id)
    return loan


class LoanDeleteMode(StrEnum):
    DETACH = "detach"
    CASCADE = "cascade"


async def delete_loan(
    db: AsyncSession,
    user_id: UUID,
    loan_id: UUID,
    *,
    mode: LoanDeleteMode = LoanDeleteMode.DETACH,
) -> None:
    """Delete a loan outright. `detach` (default) leaves its payments as
    plain expenses - `transactions.loan_id` is already `ON DELETE SET NULL`.
    `cascade` deletes those payments too."""
    loan = await ownership.get_owned(db, Loan, loan_id, user_id)
    if mode == LoanDeleteMode.CASCADE:
        await db.execute(
            delete(Transaction).where(
                Transaction.user_id == user_id, Transaction.loan_id == loan.id
            )
        )
    await db.delete(loan)
    await db.commit()


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
    loan = await _get_owned_for_update(db, user_id, loan_id)
    paid_numbers = await paid_installment_numbers(db, loan.id)
    installment_number = next_unpaid_installment_number(loan, paid_numbers)
    if installment_number is None:
        raise ValidationAppError(code="loan.fully_paid")

    account_id = data.account_id or loan.payment_account_id
    if account_id is None:
        raise ValidationAppError(code="loan.payment_account_required")

    payment_date = data.date or today
    payload = TransactionCreate(
        type=TRANSACTION_TYPE_EXPENSE,
        date=payment_date,
        amount=(
            data.amount
            if data.amount is not None
            else discounted_installment_amount(loan, installment_number, payment_date)
        ),
        currency=loan.currency,
        account_id=account_id,
        category_id=loan.category_id,
        description=data.description
        or f"{loan.name} {installment_number}/{loan.installment_count}",
        loan_id=loan.id,
    )
    transaction = await transactions_service.build_transaction(
        db, user_id, payload, loan_installment_number=installment_number
    )
    await db.commit()
    await db.refresh(transaction)
    return transaction


def _allocate_total(total: Decimal, weights: list[Decimal]) -> list[Decimal]:
    total = total.quantize(_CENTS, rounding=ROUND_HALF_UP)
    weight_total = sum(weights, Decimal(0))
    allocated: list[Decimal] = []
    for weight in weights[:-1]:
        allocated.append((total * weight / weight_total).quantize(_CENTS, rounding=ROUND_HALF_UP))
    allocated.append(total - sum(allocated, Decimal(0)))
    if any(amount <= 0 for amount in allocated):
        raise ValidationAppError(code="loan.advance_amount_too_small")
    return allocated


async def advance_payments(
    db: AsyncSession,
    user_id: UUID,
    loan_id: UUID,
    data: LoanAdvanceCreate,
    *,
    today: date_type,
) -> list[Transaction]:
    """Atomically settle the last N or every unpaid installment."""
    loan = await _get_owned_for_update(db, user_id, loan_id)
    paid_numbers = await paid_installment_numbers(db, loan.id)
    unpaid = [
        number for number in range(1, loan.installment_count + 1) if number not in paid_numbers
    ]
    if not unpaid:
        raise ValidationAppError(code="loan.fully_paid")

    if data.mode == "last":
        assert data.count is not None
        if data.count > len(unpaid):
            raise ValidationAppError(code="loan.advance_count_exceeds_remaining")
        selected = sorted(unpaid[-data.count :])
    else:
        selected = unpaid

    account_id = data.account_id or loan.payment_account_id
    if account_id is None:
        raise ValidationAppError(code="loan.payment_account_required")
    await _validate_payment_account(db, user_id, account_id, loan.currency)

    payment_date = data.date or today
    suggested = [discounted_installment_amount(loan, number, payment_date) for number in selected]
    amounts = suggested if data.amount is None else _allocate_total(data.amount, suggested)

    created: list[Transaction] = []
    for installment_number, amount in zip(selected, amounts, strict=True):
        transaction = await transactions_service.build_transaction(
            db,
            user_id,
            TransactionCreate(
                type=TRANSACTION_TYPE_EXPENSE,
                date=payment_date,
                amount=amount,
                currency=loan.currency,
                account_id=account_id,
                category_id=loan.category_id,
                description=data.description
                or f"{loan.name} {installment_number}/{loan.installment_count}",
                loan_id=loan.id,
            ),
            loan_installment_number=installment_number,
        )
        created.append(transaction)

    await db.commit()
    for transaction in created:
        await db.refresh(transaction)
    return created
