"""Categorization rule CRUD and bulk operations."""

from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.categorization_rule import CategorizationRule
from app.schemas.categorization_rule import (
    CategorizationRuleCreate,
    CategorizationRuleRead,
    CategorizationRuleUpdate,
    ReapplyRequest,
    ReapplyResult,
    RuleImportRequest,
    RuleImportResult,
    RulePackInstallResult,
    RulePackRead,
)
from app.services import categorization_rules as categorization_rules_service

router = APIRouter(prefix="/categorization-rules", tags=["categorization-rules"])


@router.get("", response_model=list[CategorizationRuleRead])
async def list_rules(user: CurrentUser, db: DbSession) -> list[CategorizationRule]:
    return list(await categorization_rules_service.list_rules(db, user.id))


@router.post("", response_model=CategorizationRuleRead, status_code=status.HTTP_201_CREATED)
async def create_rule(
    payload: CategorizationRuleCreate, user: CurrentUser, db: DbSession
) -> CategorizationRule:
    return await categorization_rules_service.create_rule(db, user.id, payload)


@router.post("/import", response_model=RuleImportResult)
async def import_rules(
    payload: RuleImportRequest, user: CurrentUser, db: DbSession
) -> RuleImportResult:
    return await categorization_rules_service.import_rules(db, user.id, payload)


@router.post("/reapply", response_model=ReapplyResult)
async def reapply_rules(payload: ReapplyRequest, user: CurrentUser, db: DbSession) -> ReapplyResult:
    updated = await categorization_rules_service.reapply_rules(
        db, user.id, overwrite=payload.overwrite
    )
    return ReapplyResult(updated=updated)


@router.get("/packs", response_model=list[RulePackRead])
async def list_rule_packs(user: CurrentUser, db: DbSession) -> list[RulePackRead]:
    return await categorization_rules_service.list_packs(db, user.id)


@router.post("/packs/{code}/install", response_model=RulePackInstallResult)
async def install_rule_pack(code: str, user: CurrentUser, db: DbSession) -> RulePackInstallResult:
    return await categorization_rules_service.install_pack(db, user.id, code)


@router.patch("/{rule_id}", response_model=CategorizationRuleRead)
async def update_rule(
    rule_id: UUID, payload: CategorizationRuleUpdate, user: CurrentUser, db: DbSession
) -> CategorizationRule:
    return await categorization_rules_service.update_rule(db, user.id, rule_id, payload)


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_rule(rule_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await categorization_rules_service.delete_rule(db, user.id, rule_id)
