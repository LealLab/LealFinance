"""CSV parsing (pure, no DB) plus the DB-backed preview/commit flow exposed
at POST /transactions/import/preview and POST /transactions/import.
"""

from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.csv_import import (
    ParsedRow,
    guess_mapping,
    parse_amount,
    parse_csv,
    parse_date,
    parse_rows,
    sniff_delimiter,
)
from tests.factories import login_as, make_user

# --- pure parsing helpers ---------------------------------------------------


def test_parse_date_iso() -> None:
    assert parse_date("2026-03-04", "auto").isoformat() == "2026-03-04"


def test_parse_date_dmy_explicit() -> None:
    assert parse_date("04/03/2026", "dmy").isoformat() == "2026-03-04"


def test_parse_date_mdy_explicit() -> None:
    assert parse_date("04/03/2026", "mdy").isoformat() == "2026-04-03"


def test_parse_date_auto_falls_back_to_dmy() -> None:
    assert parse_date("04/03/2026", "auto").isoformat() == "2026-03-04"


def test_parse_date_invalid_returns_none() -> None:
    assert parse_date("not a date", "auto") is None


def test_parse_date_blank_returns_none() -> None:
    assert parse_date("", "auto") is None


def test_parse_amount_dot_decimal() -> None:
    assert parse_amount("1,234.56", "auto") == Decimal("1234.56")


def test_parse_amount_comma_decimal() -> None:
    assert parse_amount("1.234,56", "auto") == Decimal("1234.56")


def test_parse_amount_explicit_comma_separator() -> None:
    assert parse_amount("1234,56", ",") == Decimal("1234.56")


def test_parse_amount_negative() -> None:
    assert parse_amount("-50.00", "auto") == Decimal("-50.00")


def test_parse_amount_strips_currency_symbol() -> None:
    assert parse_amount("R$ 50,00", "auto") == Decimal("50.00")


def test_parse_amount_invalid_returns_none() -> None:
    assert parse_amount("not a number", "auto") is None


def test_parse_amount_blank_returns_none() -> None:
    assert parse_amount("", "auto") is None


def test_sniff_delimiter_semicolon() -> None:
    assert sniff_delimiter("date;description;amount\n2026-01-01;Coffee;-5.00") == ";"


def test_sniff_delimiter_comma() -> None:
    assert sniff_delimiter("date,description,amount\n2026-01-01,Coffee,-5.00") == ","


def test_parse_csv_strips_bom_and_handles_quoted_comma() -> None:
    content = '﻿date;description;amount\n2026-01-01;"Coffee, large";-5.00\n'
    headers, rows = parse_csv(content)
    assert headers == ["date", "description", "amount"]
    assert rows == [{"date": "2026-01-01", "description": "Coffee, large", "amount": "-5.00"}]


def test_guess_mapping_matches_english_and_portuguese_headers() -> None:
    guess = guess_mapping(["Data", "Descrição", "Valor", "Categoria"])
    assert guess["date"] == "Data"
    assert guess["description"] == "Descrição"
    assert guess["amount"] == "Valor"
    assert guess["category"] == "Categoria"


def test_guess_mapping_leaves_unmatched_field_none() -> None:
    guess = guess_mapping(["date", "amount"])
    assert guess["category"] is None
    assert guess["notes"] is None


def test_guess_mapping_matches_transfer_fields() -> None:
    guess = guess_mapping(["Date", "Type", "Counterparty Account"])
    assert guess["type"] == "Type"
    assert guess["counterparty_account"] == "Counterparty Account"


def test_parse_rows_negative_amount_is_expense() -> None:
    raw_rows = [{"date": "2026-01-15", "description": "Coffee", "amount": "-5.00"}]
    mapping = {"date": "date", "description": "description", "amount": "amount"}
    rows = parse_rows(
        raw_rows, mapping, date_format="auto", decimal_separator="auto", invert_sign=False
    )
    assert rows == [
        ParsedRow(
            index=0,
            date=rows[0].date,
            description="Coffee",
            type="expense",
            amount=Decimal("5.00"),
            category_name=None,
            notes=None,
            error=None,
        )
    ]


def test_parse_rows_positive_amount_is_income() -> None:
    raw_rows = [{"date": "2026-01-15", "description": "Paycheck", "amount": "3000.00"}]
    mapping = {"date": "date", "description": "description", "amount": "amount"}
    rows = parse_rows(
        raw_rows, mapping, date_format="auto", decimal_separator="auto", invert_sign=False
    )
    assert rows[0].type == "income"


def test_parse_rows_explicit_transfer_uses_effective_amount_direction() -> None:
    raw_rows = [
        {
            "date": "2026-01-15",
            "description": "Move to savings",
            "amount": "-5.00",
            "type": "Transfer",
            "counterparty": "Savings",
        }
    ]
    rows = parse_rows(
        raw_rows,
        {
            "date": "date",
            "description": "description",
            "amount": "amount",
            "type": "type",
            "counterparty_account": "counterparty",
        },
        date_format="auto",
        decimal_separator="auto",
        invert_sign=False,
    )
    assert rows[0].type == "transfer"
    assert rows[0].amount == Decimal("5.00")
    assert rows[0].counterparty_account_name == "Savings"
    assert rows[0].transfer_direction == "outgoing"


def test_parse_rows_invert_sign_reverses_transfer_direction() -> None:
    rows = parse_rows(
        [{"date": "2026-01-15", "description": "Move", "amount": "-5.00", "type": "transfer"}],
        {"date": "date", "description": "description", "amount": "amount", "type": "type"},
        date_format="auto",
        decimal_separator="auto",
        invert_sign=True,
    )
    assert rows[0].transfer_direction == "incoming"


def test_parse_rows_invert_sign_flips_type() -> None:
    raw_rows = [{"date": "2026-01-15", "description": "Coffee", "amount": "5.00"}]
    mapping = {"date": "date", "description": "description", "amount": "amount"}
    rows = parse_rows(
        raw_rows, mapping, date_format="auto", decimal_separator="auto", invert_sign=True
    )
    assert rows[0].type == "expense"


def test_parse_rows_zero_amount_is_an_error() -> None:
    raw_rows = [{"date": "2026-01-15", "description": "Nothing", "amount": "0.00"}]
    mapping = {"date": "date", "description": "description", "amount": "amount"}
    rows = parse_rows(
        raw_rows, mapping, date_format="auto", decimal_separator="auto", invert_sign=False
    )
    assert rows[0].error == "import.row.zero_amount"


def test_parse_rows_invalid_date_is_an_error() -> None:
    raw_rows = [{"date": "not a date", "description": "Coffee", "amount": "-5.00"}]
    mapping = {"date": "date", "description": "description", "amount": "amount"}
    rows = parse_rows(
        raw_rows, mapping, date_format="auto", decimal_separator="auto", invert_sign=False
    )
    assert rows[0].error == "import.row.invalid_date"


def test_parse_rows_missing_description_is_an_error() -> None:
    raw_rows = [{"date": "2026-01-15", "description": "", "amount": "-5.00"}]
    mapping = {"date": "date", "description": "description", "amount": "amount"}
    rows = parse_rows(
        raw_rows, mapping, date_format="auto", decimal_separator="auto", invert_sign=False
    )
    assert rows[0].error == "import.row.missing_description"


def test_parse_rows_invalid_amount_is_an_error() -> None:
    raw_rows = [{"date": "2026-01-15", "description": "Coffee", "amount": "garbage"}]
    mapping = {"date": "date", "description": "description", "amount": "amount"}
    rows = parse_rows(
        raw_rows, mapping, date_format="auto", decimal_separator="auto", invert_sign=False
    )
    assert rows[0].error == "import.row.invalid_amount"


# --- DB-backed preview / commit flow, via the HTTP API ---------------------


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _create_account(
    client: AsyncClient, currency: str = "BRL", name: str = "Checking"
) -> str:
    response = await client.post(
        "/api/v1/accounts", json={"name": name, "type": "checking", "currency": currency}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_category(client: AsyncClient, name: str, kind: str) -> str:
    group_response = await client.post(
        "/api/v1/category-groups",
        json={"name": f"{name} Group", "kind": kind, "color": "#112233", "icon": "tag"},
    )
    assert group_response.status_code == 201
    response = await client.post(
        "/api/v1/categories",
        json={
            "name": name,
            "kind": kind,
            "group_id": group_response.json()["id"],
            "color": "#112233",
            "icon": "tag",
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


async def _create_rule(
    client: AsyncClient,
    name: str,
    category_id: str,
    conditions: list[dict[str, str]],
    match_op: str = "and",
) -> None:
    response = await client.post(
        "/api/v1/categorization-rules",
        json={
            "name": name,
            "match_op": match_op,
            "conditions": conditions,
            "category_id": category_id,
        },
    )
    assert response.status_code == 201, response.text


CSV_CONTENT = (
    "date,description,amount,category\n"
    "2026-01-15,Coffee,-5.00,Groceries\n"
    "2026-01-01,Paycheck,3000.00,Salary\n"
)


async def test_preview_matches_category_by_name(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "preview-match@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client, "Groceries", "expense")

    response = await client.post(
        "/api/v1/transactions/import/preview",
        json={"content": CSV_CONTENT, "account_id": account_id},
    )
    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    assert rows[0]["category_id"] == category_id
    assert rows[0]["type"] == "expense"
    assert rows[0]["amount"] == "5.00"
    assert rows[1]["category_id"] is None  # "Salary" category doesn't exist yet
    assert rows[0]["rule_name"] is None
    assert rows[1]["rule_name"] is None


async def test_preview_applies_rule_without_category_column(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "preview-rule@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client, "Public Transport", "expense")
    await _create_rule(
        client,
        "Uber",
        category_id,
        [{"field": "description", "op": "contains", "value": "UBER"}],
    )

    response = await client.post(
        "/api/v1/transactions/import/preview",
        json={
            "content": "date,description,amount\n2026-01-15,UBER TRIP,-12.50\n",
            "account_id": account_id,
        },
    )
    assert response.status_code == 200, response.text
    row = response.json()["rows"][0]
    assert row["category_id"] == category_id
    assert row["rule_name"] == "Uber"


async def test_preview_rule_beats_category_column(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "preview-rule-priority@example.com")
    account_id = await _create_account(client)
    transport_id = await _create_category(client, "Transport", "expense")
    await _create_category(client, "Groceries", "expense")
    await _create_rule(
        client,
        "Uber",
        transport_id,
        [{"field": "description", "op": "contains", "value": "UBER"}],
    )

    response = await client.post(
        "/api/v1/transactions/import/preview",
        json={
            "content": "date,description,amount,category\n2026-01-15,UBER TRIP,-12.50,Groceries\n",
            "account_id": account_id,
        },
    )
    assert response.status_code == 200, response.text
    row = response.json()["rows"][0]
    assert row["category_id"] == transport_id
    assert row["category_name"] == "Groceries"
    assert row["rule_name"] == "Uber"


async def test_income_rule_does_not_categorize_expense_row(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "preview-rule-kind@example.com")
    account_id = await _create_account(client)
    salary_id = await _create_category(client, "Salary", "income")
    await _create_rule(
        client,
        "Payroll",
        salary_id,
        [
            {"field": "description", "op": "contains", "value": "PAYROLL"},
            {"field": "type", "op": "equals", "value": "income"},
        ],
    )

    response = await client.post(
        "/api/v1/transactions/import/preview",
        json={
            "content": "date,description,amount\n2026-01-15,PAYROLL FEE,-12.50\n",
            "account_id": account_id,
        },
    )
    assert response.status_code == 200, response.text
    row = response.json()["rows"][0]
    assert row["type"] == "expense"
    assert row["category_id"] is None
    assert row["rule_name"] is None


async def test_preview_returns_detected_headers(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "preview-headers@example.com")
    account_id = await _create_account(client)

    response = await client.post(
        "/api/v1/transactions/import/preview",
        json={"content": CSV_CONTENT, "account_id": account_id},
    )
    assert response.status_code == 200, response.text
    assert response.json()["headers"] == ["date", "description", "amount", "category"]


async def test_preview_resolves_transfer_counterparty_and_direction(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "preview-transfer@example.com")
    account_id = await _create_account(client, name="Checking")
    counterparty_id = await _create_account(client, name="Savings")

    response = await client.post(
        "/api/v1/transactions/import/preview",
        json={
            "content": (
                "date,description,amount,type,counterparty\n"
                "2026-01-15,To savings,-5.00,Transfer,sAvInGs\n"
                "2026-01-16,From savings,6.00,transfer,savings\n"
                "2026-01-17,Same account,7.00,transfer,checking\n"
            ),
            "account_id": account_id,
        },
    )
    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    assert rows[0]["type"] == "transfer"
    assert rows[0]["counterparty_account_id"] == counterparty_id
    assert rows[0]["counterparty_account_name"] == "sAvInGs"
    assert rows[0]["transfer_direction"] == "outgoing"
    assert rows[1]["counterparty_account_id"] == counterparty_id
    assert rows[1]["transfer_direction"] == "incoming"
    assert rows[0]["category_id"] is None
    assert rows[2]["counterparty_account_id"] is None


async def test_preview_leaves_cross_currency_counterparty_unresolved(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "preview-transfer-currency@example.com")
    account_id = await _create_account(client, name="Checking")
    await _create_account(client, currency="EUR", name="Euro")

    response = await client.post(
        "/api/v1/transactions/import/preview",
        json={
            "content": (
                "date,description,amount,type,counterparty\n2026-01-15,Move,-5,transfer,Euro\n"
            ),
            "account_id": account_id,
        },
    )
    assert response.status_code == 200, response.text
    row = response.json()["rows"][0]
    assert row["counterparty_account_id"] is None
    assert row["counterparty_account_name"] == "Euro"


async def test_commit_imports_transfer_rows_without_categories(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "commit-transfer@example.com")
    selected_id = await _create_account(client, name="Checking")
    counterparty_id = await _create_account(client, name="Savings")

    response = await client.post(
        "/api/v1/transactions/import",
        json={
            "items": [
                {
                    "type": "transfer",
                    "date": "2026-01-15",
                    "amount": "5.00",
                    "currency": "BRL",
                    "account_id": selected_id,
                    "to_account_id": counterparty_id,
                    "description": "To savings",
                },
                {
                    "type": "transfer",
                    "date": "2026-01-16",
                    "amount": "6.00",
                    "currency": "BRL",
                    "account_id": counterparty_id,
                    "to_account_id": selected_id,
                    "description": "From savings",
                },
            ]
        },
    )
    assert response.status_code == 201, response.text
    assert response.json() == {"created": 2}

    rows = (await client.get("/api/v1/transactions")).json()
    assert [(row["account_id"], row["to_account_id"]) for row in rows] == [
        (counterparty_id, selected_id),
        (selected_id, counterparty_id),
    ]


async def test_commit_rejects_cross_currency_transfer_without_conversion(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "commit-transfer-currency@example.com")
    account_id = await _create_account(client, name="Checking")
    counterparty_id = await _create_account(client, currency="EUR", name="Euro")

    response = await client.post(
        "/api/v1/transactions/import",
        json={
            "items": [
                {
                    "type": "transfer",
                    "date": "2026-01-15",
                    "amount": "5.00",
                    "currency": "BRL",
                    "account_id": account_id,
                    "to_account_id": counterparty_id,
                    "description": "Move",
                }
            ]
        },
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "transaction.conversion_required"
    assert (await client.get("/api/v1/transactions")).json() == []


async def test_preview_flags_existing_transaction_as_duplicate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "preview-dup@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client, "Groceries", "expense")
    await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-15",
            "amount": "5.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Coffee",
        },
    )

    response = await client.post(
        "/api/v1/transactions/import/preview",
        json={"content": CSV_CONTENT, "account_id": account_id},
    )
    assert response.status_code == 200, response.text
    rows = response.json()["rows"]
    assert rows[0]["duplicate"] is True
    assert rows[1]["duplicate"] is False


async def test_preview_rejects_missing_required_column(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "preview-missing-col@example.com")
    account_id = await _create_account(client)

    response = await client.post(
        "/api/v1/transactions/import/preview",
        json={
            "content": "foo,bar\n1,2\n",
            "account_id": account_id,
            "mapping": {"date": "foo"},
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "import.column_required"


async def test_preview_rejects_empty_file(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "preview-empty@example.com")
    account_id = await _create_account(client)

    response = await client.post(
        "/api/v1/transactions/import/preview",
        json={"content": "date,description,amount\n", "account_id": account_id},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "import.no_rows"


async def test_commit_creates_all_reviewed_rows_in_one_request(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "commit-ok@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client, "Groceries", "expense")

    response = await client.post(
        "/api/v1/transactions/import",
        json={
            "items": [
                {
                    "type": "expense",
                    "date": "2026-01-15",
                    "amount": "5.00",
                    "currency": "BRL",
                    "account_id": account_id,
                    "category_id": category_id,
                    "description": "Coffee",
                },
                {
                    "type": "expense",
                    "date": "2026-01-16",
                    "amount": "6.00",
                    "currency": "BRL",
                    "account_id": account_id,
                    "category_id": category_id,
                    "description": "Tea",
                },
            ]
        },
    )
    assert response.status_code == 201, response.text
    assert response.json() == {"created": 2}

    listed = await client.get("/api/v1/transactions")
    assert len(listed.json()) == 2


async def test_commit_rolls_back_entirely_when_one_item_is_invalid(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "commit-rollback@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client, "Groceries", "expense")

    response = await client.post(
        "/api/v1/transactions/import",
        json={
            "items": [
                {
                    "type": "expense",
                    "date": "2026-01-15",
                    "amount": "5.00",
                    "currency": "BRL",
                    "account_id": account_id,
                    "category_id": category_id,
                    "description": "Coffee",
                },
                {
                    "type": "expense",
                    "date": "2026-01-16",
                    "amount": "6.00",
                    "currency": "BRL",
                    "account_id": "00000000-0000-0000-0000-000000000000",
                    "category_id": category_id,
                    "description": "Tea",
                },
            ]
        },
    )
    assert response.status_code == 404, response.text

    listed = await client.get("/api/v1/transactions")
    assert listed.json() == []


async def test_row_limit_is_enforced(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "row-limit@example.com")
    account_id = await _create_account(client)

    header = "date,description,amount\n"
    body = "\n".join(f"2026-01-01,Row {i},1.00" for i in range(2001))
    response = await client.post(
        "/api/v1/transactions/import/preview",
        json={"content": header + body, "account_id": account_id},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "import.too_many_rows"
