"""CRUD, import, and application of categorization rules."""

import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ConflictError, NotFoundError
from app.models.categorization_rule import CategorizationRule
from app.models.category import Category
from app.models.transaction import TRANSACTION_TYPE_EXPENSE, TRANSACTION_TYPE_INCOME
from app.schemas.categorization_rule import (
    CategorizationRuleCreate,
    CategorizationRuleUpdate,
    RuleCondition,
    RuleImportRequest,
    RuleImportResult,
    RulePackInstallResult,
    RulePackRead,
)
from app.services import ownership
from app.services.default_categories import category_kind_for_key, category_names_for_key
from app.services.rule_engine import CompiledRule, RuleInput, first_match, normalize
from app.services.transactions import list_transactions

_PACKS = json.loads(
    (Path(__file__).parent.parent / "data" / "rule_packs.json").read_text(encoding="utf-8")
)


@dataclass(frozen=True)
class _RuleSpec:
    """Resolved rule shape shared with rule-pack installation."""

    name: str
    priority: int
    is_active: bool
    match_op: str
    conditions: list[dict[str, object]]
    category_id: UUID


async def list_rules(db: AsyncSession, user_id: UUID) -> Sequence[CategorizationRule]:
    query = ownership.owned(CategorizationRule, user_id).order_by(
        CategorizationRule.priority,
        CategorizationRule.created_at,
        CategorizationRule.id,
    )
    return (await db.execute(query)).scalars().all()


async def list_packs(db: AsyncSession, user_id: UUID) -> list[RulePackRead]:
    existing_names = {
        rule.name for rule in await ownership.list_owned(db, CategorizationRule, user_id)
    }
    return [
        RulePackRead(
            code=pack["code"],
            rule_count=len(pack["rules"]),
            installed=(
                {rule["name"] for rule in pack["rules"]}.issubset(existing_names)
                and bool(pack["rules"])
            ),
        )
        for pack in _PACKS["packs"]
    ]


async def install_pack(db: AsyncSession, user_id: UUID, code: str) -> RulePackInstallResult:
    pack = next((pack for pack in _PACKS["packs"] if pack["code"] == code.upper()), None)
    if pack is None:
        raise NotFoundError(code="rule_pack.not_found", params={"code": code})

    user_categories = await ownership.list_owned(db, Category, user_id)
    category_index = {
        (category.kind, normalize(category.name)): category.id for category in user_categories
    }
    specs: list[_RuleSpec] = []
    skipped = 0
    for rule in pack["rules"]:
        kind = category_kind_for_key(rule["categoryKey"])
        assert kind is not None
        category_id = next(
            (
                category_index[(kind, normalize(name))]
                for name in category_names_for_key(rule["categoryKey"])
                if (kind, normalize(name)) in category_index
            ),
            None,
        )
        if category_id is None:
            skipped += 1
            continue
        specs.append(
            _RuleSpec(
                name=rule["name"],
                priority=rule.get("priority", 10),
                is_active=True,
                match_op=rule["matchOp"],
                conditions=rule["conditions"],
                category_id=category_id,
            )
        )

    inserted, name_skipped = await install_rules_internal(db, user_id, specs, replace=False)
    return RulePackInstallResult(installed=inserted, skipped=skipped + name_skipped)


async def get_rule(db: AsyncSession, user_id: UUID, rule_id: UUID) -> CategorizationRule:
    return await ownership.get_owned(db, CategorizationRule, rule_id, user_id)


async def _commit_rule(db: AsyncSession, rule: CategorizationRule) -> CategorizationRule:
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise ConflictError(code="categorization_rule.duplicate_name") from exc
    await db.refresh(rule)
    return rule


async def create_rule(
    db: AsyncSession, user_id: UUID, payload: CategorizationRuleCreate
) -> CategorizationRule:
    await ownership.get_owned(db, Category, payload.category_id, user_id)
    rule = CategorizationRule(
        user_id=user_id,
        name=payload.name,
        priority=payload.priority,
        is_active=payload.is_active,
        match_op=payload.match_op,
        conditions=[condition.model_dump() for condition in payload.conditions],
        category_id=payload.category_id,
    )
    db.add(rule)
    return await _commit_rule(db, rule)


async def update_rule(
    db: AsyncSession, user_id: UUID, rule_id: UUID, payload: CategorizationRuleUpdate
) -> CategorizationRule:
    rule = await ownership.get_owned(db, CategorizationRule, rule_id, user_id)
    changes = payload.model_dump(exclude_unset=True)
    if "category_id" in changes:
        await ownership.get_owned(db, Category, changes["category_id"], user_id)
    for field, value in changes.items():
        setattr(rule, field, value)
    return await _commit_rule(db, rule)


async def delete_rule(db: AsyncSession, user_id: UUID, rule_id: UUID) -> None:
    rule = await ownership.get_owned(db, CategorizationRule, rule_id, user_id)
    await db.delete(rule)
    await db.commit()


async def load_active_rules(db: AsyncSession, user_id: UUID) -> list[CompiledRule]:
    query = (
        ownership.owned(CategorizationRule, user_id)
        .join(
            Category,
            (Category.id == CategorizationRule.category_id) & (Category.user_id == user_id),
        )
        .add_columns(Category.kind)
        .where(CategorizationRule.is_active.is_(True))
        .order_by(
            CategorizationRule.priority,
            CategorizationRule.created_at,
            CategorizationRule.id,
        )
    )
    rows = (await db.execute(query)).all()
    return [
        CompiledRule(
            id=rule.id,
            name=rule.name,
            category_id=rule.category_id,
            category_kind=kind,
            match_op=rule.match_op,
            conditions=rule.conditions,
        )
        for rule, kind in rows
    ]


async def install_rules_internal(
    db: AsyncSession, user_id: UUID, items: list[_RuleSpec], *, replace: bool
) -> tuple[int, int]:
    existing = list(await ownership.list_owned(db, CategorizationRule, user_id))
    if replace:
        for rule in existing:
            await db.delete(rule)
        await db.flush()
        existing_names: set[str] = set()
    else:
        existing_names = {rule.name for rule in existing}

    inserted = 0
    skipped = 0
    for item in items:
        if not replace and item.name in existing_names:
            skipped += 1
            continue
        db.add(
            CategorizationRule(
                user_id=user_id,
                name=item.name,
                priority=item.priority,
                is_active=item.is_active,
                match_op=item.match_op,
                conditions=item.conditions,
                category_id=item.category_id,
            )
        )
        inserted += 1
        existing_names.add(item.name)

    await db.commit()
    return inserted, skipped


async def import_rules(db: AsyncSession, user_id: UUID, req: RuleImportRequest) -> RuleImportResult:
    categories = await ownership.list_owned(db, Category, user_id)
    categories_by_name: dict[str, Category] = {}
    for category in categories:
        categories_by_name.setdefault(category.name.casefold(), category)

    items: list[_RuleSpec] = []
    skipped = 0
    for item in req.rules:
        resolved_category = categories_by_name.get(item.category.casefold())
        if resolved_category is None:
            skipped += 1
            continue
        items.append(
            _RuleSpec(
                name=item.name,
                priority=item.priority,
                is_active=item.is_active,
                match_op=item.match_op,
                conditions=[condition.model_dump() for condition in item.conditions],
                category_id=resolved_category.id,
            )
        )

    imported, collisions = await install_rules_internal(db, user_id, items, replace=req.replace)
    return RuleImportResult(imported=imported, skipped=skipped + collisions)


async def reapply_rules(db: AsyncSession, user_id: UUID, *, overwrite: bool) -> int:
    rules = await load_active_rules(db, user_id)
    # ponytail: loads the whole ledger in memory; chunk by date range if a user's
    # transaction count ever makes this hurt
    page = await list_transactions(
        db,
        user_id,
        types=[TRANSACTION_TYPE_INCOME, TRANSACTION_TYPE_EXPENSE],
        limit=None,
    )
    updated = 0
    for transaction in page.rows:
        matched = first_match(
            rules,
            RuleInput(
                description=transaction.description,
                notes=transaction.notes,
                amount=transaction.amount,
                type=transaction.type,
            ),
        )
        if matched is None:
            continue
        if not overwrite and transaction.category_id is not None:
            continue
        if transaction.category_id == matched.category_id:
            continue
        transaction.category_id = matched.category_id
        updated += 1
    await db.commit()
    return updated


def _validate_packs() -> None:
    conditions = TypeAdapter(list[RuleCondition])
    for pack in _PACKS["packs"]:
        for rule in pack["rules"]:
            conditions.validate_python(rule["conditions"])
            assert category_kind_for_key(rule["categoryKey"]) is not None


_validate_packs()
