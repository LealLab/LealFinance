"""Materializes due RecurringRule occurrences into real Transactions - the
posting half of recurring rules (see app/models/recurring.py's module
docstring for the split with the frontend's on-demand projection). Driven
by Celery beat via app/workers/tasks/recurring.py.

Idempotency is enforced twice: `last_posted_date` skips already-posted
occurrences on the happy path, and a partial unique index on
transactions(recurring_rule_id, date) makes a duplicate impossible even if
a run is retried or two workers race.

Posting reuses app/services/transactions.py::create_transaction verbatim
(same shape validation, same conversion arithmetic) rather than
duplicating either - the one exception is cross-currency: the template's
own conversion_rate is frozen from whenever the rule was last edited, so
posting it unchanged for months or years would post stale money. Each
occurrence instead re-resolves a live rate as-of its own date.
"""

import logging
from datetime import date as date_type
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.recurring import RecurringRule
from app.models.transaction import Transaction
from app.schemas.transaction import ConversionInput, TransactionCreate
from app.services import ownership
from app.services import transactions as transactions_service
from app.services.exchange_rates import get_exchange_rate, to_conversion_source
from app.services.recurrence import project_occurrence_dates

logger = logging.getLogger(__name__)

# A rule that's been dormant a long time (or backdated far in the past)
# shouldn't post hundreds of occurrences in a single run - cap catch-up
# per rule per run. Any remainder posts on the next run instead.
MAX_CATCH_UP_OCCURRENCES = 60


async def post_due_occurrences(
    db: AsyncSession, rule: RecurringRule, *, today: date_type
) -> list[UUID]:
    """Posts every occurrence of `rule` on or before `today` that hasn't
    posted yet, advancing `rule.last_posted_date` one occurrence at a
    time. Each occurrence commits (via create_transaction) together with
    the cursor move that produced it, so a failure partway through a
    catch-up run leaves the cursor at the last real success rather than
    silently skipping ahead."""
    range_start = (
        rule.last_posted_date + timedelta(days=1) if rule.last_posted_date else rule.start_date
    )
    if range_start > today:
        return []

    occurrence_dates = project_occurrence_dates(
        start_date=rule.start_date,
        frequency=rule.frequency,
        interval=rule.interval,
        end_date=rule.end_date,
        range_start=range_start,
        range_end=today,
    )[:MAX_CATCH_UP_OCCURRENCES]

    created_ids: list[UUID] = []
    for occurrence in occurrence_dates:
        rule.last_posted_date = occurrence
        transaction = await _post_one(db, rule, occurrence)
        created_ids.append(transaction.id)

    return created_ids


async def _post_one(db: AsyncSession, rule: RecurringRule, occurrence: date_type) -> Transaction:
    template = rule.template

    account = await ownership.get_owned(db, Account, template.account_id, rule.user_id)
    to_account = (
        await ownership.get_owned(db, Account, template.to_account_id, rule.user_id)
        if template.to_account_id is not None
        else None
    )
    destination_currency = to_account.currency if to_account is not None else account.currency

    conversion_input: ConversionInput | None = None
    if template.currency != destination_currency:
        rate_result = await get_exchange_rate(
            db, template.currency, destination_currency, user_id=rule.user_id, as_of=occurrence
        )
        conversion_input = ConversionInput(
            amount=None,  # resolve_conversion derives it from the live rate below
            currency=destination_currency,
            fee=template.conversion.fee if template.conversion else None,
            rate=rate_result.rate,
            source=to_conversion_source(rate_result),
        )

    data = TransactionCreate(
        type=template.type,
        date=occurrence,
        amount=template.amount,
        currency=template.currency,
        account_id=template.account_id,
        to_account_id=template.to_account_id,
        category_id=template.category_id,
        description=template.description,
        notes=template.notes,
        recurring_rule_id=rule.id,
        conversion=conversion_input,
    )
    return await transactions_service.create_transaction(db, rule.user_id, data)


async def post_all_due_occurrences(db: AsyncSession, *, today: date_type | None = None) -> int:
    """One posting pass across every user's recurring rules. Returns the
    total number of transactions created. A single rule's failure (an
    archived account, a currency gone inactive, a race on the idempotency
    index) is logged and rolled back without aborting the rest of the
    run - see the module docstring."""
    # ponytail: "today" is UTC's today - there's no per-user timezone on
    # the users table, so a user far east of UTC can see an occurrence
    # post up to ~13h after their local midnight. Add users.timezone and
    # resolve "today" per user if that skew ever matters.
    today = today or date_type.today()
    result = await db.execute(select(RecurringRule))
    rules = result.scalars().all()

    total_posted = 0
    for rule in rules:
        try:
            created = await post_due_occurrences(db, rule, today=today)
            total_posted += len(created)
        except Exception:
            logger.exception("Failed to post occurrences for recurring rule %s", rule.id)
            await db.rollback()

    return total_posted
