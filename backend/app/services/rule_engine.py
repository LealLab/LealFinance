"""Pure matching engine for categorization rules."""

import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from uuid import UUID


@dataclass(frozen=True)
class RuleInput:
    description: str
    notes: str | None
    amount: Decimal
    type: str


@dataclass(frozen=True)
class CompiledRule:
    id: UUID
    name: str
    category_id: UUID
    category_kind: str
    match_op: str
    conditions: list[dict[str, object]]


def _strip_marks(text: str) -> str:
    return "".join(
        character
        for character in unicodedata.normalize("NFKD", text)
        if not unicodedata.combining(character)
    )


def normalize(text: str) -> str:
    return _strip_marks(text).casefold()


def _text_value(row: RuleInput, field: str) -> str:
    return row.notes or "" if field == "notes" else row.description


def _matches_leaf(condition: dict[str, object], row: RuleInput) -> bool:
    field = condition.get("field")
    op = condition.get("op")
    value = condition.get("value")
    if not isinstance(field, str) or not isinstance(op, str) or not isinstance(value, str):
        return False
    if value.strip() == "":
        return False

    if field in {"description", "notes"}:
        actual = normalize(_text_value(row, field))
        expected = normalize(value)
        if op == "contains":
            return expected in actual
        if op == "not_contains":
            return expected not in actual
        if op == "equals":
            return actual == expected
        if op == "not_equals":
            return actual != expected
        if op == "starts_with":
            return actual.startswith(expected)
        if op == "ends_with":
            return actual.endswith(expected)
        if op == "regex":
            try:
                return re.search(_strip_marks(value), actual, flags=re.IGNORECASE) is not None
            except re.error:
                return False
        return False

    if field == "amount":
        try:
            expected_amount = Decimal(value)
            if op == "equals":
                return row.amount == expected_amount
            if op == "gt":
                return row.amount > expected_amount
            if op == "gte":
                return row.amount >= expected_amount
            if op == "lt":
                return row.amount < expected_amount
            if op == "lte":
                return row.amount <= expected_amount
        except (InvalidOperation, ValueError):
            return False
        return False

    if field == "type":
        if op == "equals":
            return row.type == value
        if op == "not_equals":
            return row.type != value
    return False


def _combine(values: list[bool], op: str) -> bool:
    if not values:
        return False
    if op == "and":
        return all(values)
    if op == "or":
        return any(values)
    return False


def _matches_condition(condition: dict[str, object], row: RuleInput) -> bool:
    if "conditions" not in condition:
        return _matches_leaf(condition, row)
    group_conditions = condition.get("conditions")
    group_op = condition.get("op")
    if not isinstance(group_conditions, list) or not isinstance(group_op, str):
        return False
    return _combine(
        [_matches_leaf(leaf, row) for leaf in group_conditions if isinstance(leaf, dict)],
        group_op,
    )


def matches(rule: CompiledRule, row: RuleInput) -> bool:
    return _combine(
        [_matches_condition(condition, row) for condition in rule.conditions], rule.match_op
    )


def first_match(rules: Sequence[CompiledRule], row: RuleInput) -> CompiledRule | None:
    for rule in rules:
        if rule.category_kind == row.type and matches(rule, row):
            return rule
    return None
