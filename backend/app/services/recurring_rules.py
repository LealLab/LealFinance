"""Recurring rule CRUD. A rule's `template` mirrors a transaction (see
app/models/recurring.py) and is validated with the exact same shape and
conversion rules as a real transaction
(app/services/transactions.py::validate_transaction_shape).

CRUD only - actually posting a rule's due occurrences as transactions is
app/services/recurring_posting.py, run nightly by Celery beat. The
frontend still projects *upcoming* occurrences on demand for display
(domain/calc/recurrence.ts); those are separate from what gets posted.
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models._conversion import ConversionValue
from app.models.recurring import RecurringRule
from app.schemas.recurring import RecurringRuleCreate, RecurringRuleUpdate, RecurringTemplateInput
from app.services import ownership
from app.services.conversion import resolve_conversion
from app.services.currencies import get_active_currency
from app.services.transactions import to_conversion_input, validate_transaction_shape


async def _resolve_template(
    db: AsyncSession, user_id: UUID, template: RecurringTemplateInput
) -> ConversionValue | None:
    await get_active_currency(db, template.currency)
    account, to_account = await validate_transaction_shape(
        db,
        user_id,
        type_=template.type,
        account_id=template.account_id,
        to_account_id=template.to_account_id,
        category_id=template.category_id,
        currency=template.currency,
    )
    destination_currency = to_account.currency if to_account is not None else account.currency
    return await resolve_conversion(
        db,
        origin_amount=template.amount,
        origin_currency=template.currency,
        destination_currency=destination_currency,
        payload=to_conversion_input(template.conversion),
    )


def _apply_template(
    rule: RecurringRule, template: RecurringTemplateInput, conversion: ConversionValue | None
) -> None:
    rule.template_type = template.type
    rule.template_amount = template.amount
    rule.template_currency = template.currency
    rule.template_account_id = template.account_id
    rule.template_to_account_id = template.to_account_id
    rule.template_category_id = template.category_id
    rule.template_description = template.description
    rule.template_notes = template.notes
    rule.template_conversion_amount = conversion.amount if conversion else None
    rule.template_conversion_currency = conversion.currency if conversion else None
    rule.template_conversion_fee = conversion.fee if conversion else None
    rule.template_conversion_rate = conversion.rate if conversion else None
    rule.template_conversion_source = conversion.source if conversion else None


async def list_recurring_rules(db: AsyncSession, user_id: UUID) -> list[RecurringRule]:
    return list(await ownership.list_owned(db, RecurringRule, user_id))


async def create_recurring_rule(
    db: AsyncSession, user_id: UUID, data: RecurringRuleCreate
) -> RecurringRule:
    if data.end_date is not None and data.end_date < data.start_date:
        raise ValidationAppError(code="recurring_rule.end_before_start")

    conversion = await _resolve_template(db, user_id, data.template)

    rule = RecurringRule(
        user_id=user_id,
        frequency=data.frequency,
        interval=data.interval,
        start_date=data.start_date,
        end_date=data.end_date,
    )
    _apply_template(rule, data.template, conversion)

    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    return rule


async def update_recurring_rule(
    db: AsyncSession, user_id: UUID, rule_id: UUID, data: RecurringRuleUpdate
) -> RecurringRule:
    rule = await ownership.get_owned(db, RecurringRule, rule_id, user_id)
    changes = data.model_dump(exclude_unset=True, exclude={"template"})
    template_provided = "template" in data.model_fields_set

    new_start = changes.get("start_date", rule.start_date)
    new_end = changes.get("end_date", rule.end_date)
    if new_end is not None and new_end < new_start:
        raise ValidationAppError(code="recurring_rule.end_before_start")

    for field, value in changes.items():
        setattr(rule, field, value)

    if template_provided:
        assert data.template is not None
        conversion = await _resolve_template(db, user_id, data.template)
        _apply_template(rule, data.template, conversion)

    await db.commit()
    await db.refresh(rule)
    return rule


async def delete_recurring_rule(db: AsyncSession, user_id: UUID, rule_id: UUID) -> None:
    rule = await ownership.get_owned(db, RecurringRule, rule_id, user_id)
    await db.delete(rule)
    await db.commit()
