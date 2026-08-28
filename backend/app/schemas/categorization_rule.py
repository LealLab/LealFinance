"""DTOs for user-defined transaction categorization rules."""

import re
from decimal import Decimal, InvalidOperation
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import PatchModel

RuleField = Literal["description", "notes", "amount", "type"]
MatchOp = Literal["and", "or"]

_TEXT_OPS = {
    "contains",
    "not_contains",
    "equals",
    "not_equals",
    "starts_with",
    "ends_with",
    "regex",
}
_AMOUNT_OPS = {"equals", "gt", "gte", "lt", "lte"}
_TYPE_OPS = {"equals", "not_equals"}
_RULE_TYPES = {"income", "expense"}


def _validate_leaf(leaf: "RuleLeaf") -> "RuleLeaf":
    from app.core.errors import ValidationAppError

    if leaf.value.strip() == "":
        raise ValidationAppError(code="categorization_rule.blank_value")

    legal_ops = {
        "description": _TEXT_OPS,
        "notes": _TEXT_OPS,
        "amount": _AMOUNT_OPS,
        "type": _TYPE_OPS,
    }[leaf.field]
    if leaf.op not in legal_ops:
        raise ValidationAppError(code="categorization_rule.invalid_operator")

    if leaf.op == "regex":
        try:
            pattern = re.compile(leaf.value)
        except re.error:
            raise ValidationAppError(code="categorization_rule.invalid_regex") from None
        if pattern.match("") is not None:
            raise ValidationAppError(code="categorization_rule.invalid_regex")

    if leaf.field == "amount":
        try:
            Decimal(leaf.value)
        except InvalidOperation:
            raise ValidationAppError(code="categorization_rule.invalid_amount") from None

    if leaf.field == "type" and leaf.value not in _RULE_TYPES:
        raise ValidationAppError(code="categorization_rule.invalid_type_value")
    return leaf


class RuleLeaf(BaseModel):
    field: RuleField
    op: str
    value: str

    def model_post_init(self, _context: object) -> None:
        _validate_leaf(self)


class RuleGroup(BaseModel):
    op: MatchOp
    conditions: list[RuleLeaf]

    @field_validator("conditions")
    @classmethod
    def _conditions_must_not_be_empty(cls, value: list[RuleLeaf]) -> list[RuleLeaf]:
        from app.core.errors import ValidationAppError

        if not value:
            raise ValidationAppError(code="categorization_rule.no_conditions")
        return value


RuleCondition = RuleLeaf | RuleGroup


def _conditions_must_not_be_empty(value: list[RuleCondition]) -> list[RuleCondition]:
    from app.core.errors import ValidationAppError

    if not value:
        raise ValidationAppError(code="categorization_rule.no_conditions")
    return value


class CategorizationRuleCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    priority: int = 10
    is_active: bool = True
    match_op: MatchOp
    conditions: list[RuleCondition]
    category_id: UUID

    _validate_conditions = field_validator("conditions")(_conditions_must_not_be_empty)


class CategorizationRuleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    priority: int
    is_active: bool
    match_op: MatchOp
    conditions: list[RuleCondition]
    category_id: UUID


class CategorizationRuleUpdate(PatchModel):
    non_nullable_fields = frozenset(
        {"name", "priority", "is_active", "match_op", "conditions", "category_id"}
    )

    name: str | None = Field(default=None, min_length=1, max_length=100)
    priority: int | None = None
    is_active: bool | None = None
    match_op: MatchOp | None = None
    conditions: list[RuleCondition] | None = None
    category_id: UUID | None = None

    @field_validator("conditions")
    @classmethod
    def _conditions_must_not_be_empty(
        cls, value: list[RuleCondition] | None
    ) -> list[RuleCondition] | None:
        return None if value is None else _conditions_must_not_be_empty(value)


class RuleImportItem(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    match_op: MatchOp
    priority: int = 10
    is_active: bool = True
    conditions: list[RuleCondition]
    category: str = Field(min_length=1, max_length=100)

    _validate_conditions = field_validator("conditions")(_conditions_must_not_be_empty)


class RuleImportRequest(BaseModel):
    rules: list[RuleImportItem]
    replace: bool = False


class RuleImportResult(BaseModel):
    imported: int
    skipped: int


class ReapplyRequest(BaseModel):
    overwrite: bool = False


class ReapplyResult(BaseModel):
    updated: int


class RulePackRead(BaseModel):
    code: str
    rule_count: int
    installed: bool


class RulePackInstallResult(BaseModel):
    installed: int
    skipped: int
