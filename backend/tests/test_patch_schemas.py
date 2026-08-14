"""PATCH omission/null semantics shared by the domain update DTOs."""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from pydantic import BaseModel, TypeAdapter, ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.account import AccountUpdate
from app.schemas.category import CategoryUpdate
from app.schemas.common import CurrencyCodeInput
from app.schemas.institution import InstitutionUpdate
from app.schemas.recurring import RecurringRuleUpdate
from app.schemas.transaction import TransactionUpdate
from app.schemas.user import PreferencesUpdate, UserUpdate
from tests.factories import login_as, make_user

PATCH_MODELS: tuple[type[BaseModel], ...] = (
    AccountUpdate,
    CategoryUpdate,
    InstitutionUpdate,
    TransactionUpdate,
    RecurringRuleUpdate,
    UserUpdate,
    PreferencesUpdate,
)


@pytest.mark.parametrize("schema", PATCH_MODELS)
def test_patch_models_treat_omission_as_unchanged(schema: type[BaseModel]) -> None:
    assert schema.model_validate({}).model_dump(exclude_unset=True) == {}


@pytest.mark.parametrize(
    ("schema", "field"),
    (
        (AccountUpdate, "name"),
        (AccountUpdate, "type"),
        (AccountUpdate, "currency"),
        (AccountUpdate, "opening_balance"),
        (AccountUpdate, "archived"),
        (CategoryUpdate, "name"),
        (CategoryUpdate, "kind"),
        (CategoryUpdate, "color"),
        (CategoryUpdate, "icon"),
        (CategoryUpdate, "archived"),
        (CategoryUpdate, "position"),
        (InstitutionUpdate, "name"),
        (InstitutionUpdate, "icon"),
        (InstitutionUpdate, "archived"),
        (InstitutionUpdate, "position"),
        (TransactionUpdate, "type"),
        (TransactionUpdate, "date"),
        (TransactionUpdate, "amount"),
        (TransactionUpdate, "currency"),
        (TransactionUpdate, "account_id"),
        (TransactionUpdate, "description"),
        (RecurringRuleUpdate, "frequency"),
        (RecurringRuleUpdate, "interval"),
        (RecurringRuleUpdate, "start_date"),
        (RecurringRuleUpdate, "template"),
        (UserUpdate, "role"),
        (UserUpdate, "is_active"),
        (UserUpdate, "display_name"),
        (PreferencesUpdate, "locale"),
        (PreferencesUpdate, "theme"),
        (PreferencesUpdate, "display_currency"),
        (PreferencesUpdate, "balances_hidden"),
    ),
)
def test_patch_models_reject_explicit_null_for_required_fields(
    schema: type[BaseModel], field: str
) -> None:
    with pytest.raises(ValidationError):
        schema.model_validate({field: None})


@pytest.mark.parametrize(
    ("schema", "field"),
    (
        (AccountUpdate, "institution_id"),
        (AccountUpdate, "credit_limit"),
        (AccountUpdate, "closing_day"),
        (AccountUpdate, "due_day"),
        (CategoryUpdate, "parent_id"),
        (InstitutionUpdate, "color"),
        (TransactionUpdate, "to_account_id"),
        (TransactionUpdate, "category_id"),
        (TransactionUpdate, "notes"),
        (TransactionUpdate, "recurring_rule_id"),
        (TransactionUpdate, "conversion"),
        (RecurringRuleUpdate, "end_date"),
    ),
)
def test_patch_models_keep_nullable_fields_clearable(schema: type[BaseModel], field: str) -> None:
    assert schema.model_validate({field: None}).model_dump(exclude_unset=True) == {field: None}


def test_currency_code_input_normalizes_lowercase() -> None:
    assert TypeAdapter(CurrencyCodeInput).validate_python("brl") == "BRL"


async def test_null_recurring_template_returns_422_instead_of_service_assertion(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="null-template@example.com")
    await login_as(client, email=user.email, password=password)

    response = await client.patch(f"/api/v1/recurring-rules/{uuid4()}", json={"template": None})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "error.validation"


async def test_lowercase_currency_is_normalized_before_account_persistence(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, password = await make_user(db_session, email="lowercase-currency@example.com")
    await login_as(client, email=user.email, password=password)

    response = await client.post(
        "/api/v1/accounts",
        json={"name": "Checking", "type": "checking", "currency": "brl"},
    )

    assert response.status_code == 201, response.text
    assert response.json()["currency"] == "BRL"
