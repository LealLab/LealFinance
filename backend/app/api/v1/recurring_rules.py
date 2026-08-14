"""Recurring rule CRUD. Rules are projections only - see
app/services/recurring_rules.py."""

from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.recurring import RecurringRule
from app.schemas.recurring import RecurringRuleCreate, RecurringRuleRead, RecurringRuleUpdate
from app.services import recurring_rules as recurring_rules_service

router = APIRouter(prefix="/recurring-rules", tags=["recurring-rules"])


@router.get("", response_model=list[RecurringRuleRead])
async def list_recurring_rules(user: CurrentUser, db: DbSession) -> list[RecurringRule]:
    return await recurring_rules_service.list_recurring_rules(db, user.id)


@router.post("", response_model=RecurringRuleRead, status_code=status.HTTP_201_CREATED)
async def create_recurring_rule(
    payload: RecurringRuleCreate, user: CurrentUser, db: DbSession
) -> RecurringRule:
    return await recurring_rules_service.create_recurring_rule(db, user.id, payload)


@router.patch("/{rule_id}", response_model=RecurringRuleRead)
async def update_recurring_rule(
    rule_id: UUID, payload: RecurringRuleUpdate, user: CurrentUser, db: DbSession
) -> RecurringRule:
    return await recurring_rules_service.update_recurring_rule(db, user.id, rule_id, payload)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_recurring_rule(rule_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await recurring_rules_service.delete_recurring_rule(db, user.id, rule_id)
