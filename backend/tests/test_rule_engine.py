from decimal import Decimal
from uuid import uuid4

from app.services.rule_engine import CompiledRule, RuleInput, first_match, matches, normalize


def _rule(
    conditions: list[dict[str, object]],
    *,
    match_op: str = "and",
    category_kind: str = "expense",
) -> CompiledRule:
    return CompiledRule(
        id=uuid4(),
        name="test",
        category_id=uuid4(),
        category_kind=category_kind,
        match_op=match_op,
        conditions=conditions,
    )


def test_normalize_and_text_operators() -> None:
    row = RuleInput("Café da manhã", "Team lunch", Decimal("12.50"), "expense")
    assert normalize("Café") == "cafe"
    assert matches(_rule([{"field": "description", "op": "contains", "value": "CAFE"}]), row)
    assert matches(_rule([{"field": "description", "op": "starts_with", "value": "cafe"}]), row)
    assert matches(_rule([{"field": "description", "op": "ends_with", "value": "manhã"}]), row)
    assert matches(_rule([{"field": "notes", "op": "equals", "value": "TEAM LUNCH"}]), row)
    assert matches(_rule([{"field": "description", "op": "regex", "value": "^cafe"}]), row)
    assert matches(_rule([{"field": "description", "op": "not_contains", "value": "dinner"}]), row)
    assert matches(_rule([{"field": "description", "op": "not_equals", "value": "breakfast"}]), row)


def test_amount_type_groups_and_empty_values() -> None:
    row = RuleInput("Rent", None, Decimal("1000.00"), "expense")
    rule = _rule(
        [
            {"field": "amount", "op": "gte", "value": "1000"},
            {
                "op": "or",
                "conditions": [
                    {"field": "type", "op": "equals", "value": "income"},
                    {"field": "type", "op": "equals", "value": "expense"},
                ],
            },
        ]
    )
    assert matches(rule, row)
    assert not matches(_rule([], match_op="or"), row)
    assert not matches(_rule([{"field": "description", "op": "contains", "value": "   "}]), row)
    assert not matches(_rule([{"field": "amount", "op": "equals", "value": "not-a-number"}]), row)


def test_first_match_respects_order_and_category_kind() -> None:
    row = RuleInput("Salary", None, Decimal("5000"), "income")
    wrong_kind = _rule(
        [{"field": "description", "op": "contains", "value": "salary"}],
        category_kind="expense",
    )
    right_kind = _rule(
        [{"field": "description", "op": "contains", "value": "salary"}],
        category_kind="income",
    )
    assert first_match([wrong_kind, right_kind], row) is right_kind
