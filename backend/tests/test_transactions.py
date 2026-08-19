"""Transaction invariants (amount, transfer shape, category kind
matching, cross-currency conversion), filtering, and ownership isolation.
"""

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from tests.factories import login_as, make_user


async def _authed(client: AsyncClient, db_session: AsyncSession, email: str) -> None:
    user, password = await make_user(db_session, email=email)
    await login_as(client, email=user.email, password=password)


async def _create_account(
    client: AsyncClient, name: str = "Checking", currency: str = "BRL"
) -> str:
    response = await client.post(
        "/api/v1/accounts", json={"name": name, "type": "checking", "currency": currency}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_category(
    client: AsyncClient, name: str = "Groceries", kind: str = "expense"
) -> str:
    response = await client.post(
        "/api/v1/categories",
        json={"name": name, "kind": kind, "color": "#112233", "icon": "tag"},
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_create_expense_transaction(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "alice@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-15",
            "amount": "50.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Groceries run",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["amount"] == "50.0000"
    assert body["conversion"] is None


async def test_create_income_transaction(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "bob@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client, name="Salary", kind="income")

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "income",
            "date": "2026-01-01",
            "amount": "3000.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Paycheck",
        },
    )
    assert response.status_code == 201


async def test_create_transfer_transaction(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "carol@example.com")
    source_id = await _create_account(client, name="Checking")
    dest_id = await _create_account(client, name="Savings")

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "transfer",
            "date": "2026-01-10",
            "amount": "200.00",
            "currency": "BRL",
            "account_id": source_id,
            "to_account_id": dest_id,
            "description": "Move to savings",
        },
    )
    assert response.status_code == 201
    assert response.json()["to_account_id"] == dest_id


async def test_transfer_currency_must_match_source_account(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "transfer-currency@example.com")
    source_id = await _create_account(client, name="Dollar source", currency="USD")
    dest_id = await _create_account(client, name="Real destination", currency="BRL")

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "transfer",
            "date": "2026-01-10",
            "amount": "200.00",
            "currency": "BRL",
            "account_id": source_id,
            "to_account_id": dest_id,
            "description": "Wrong source currency",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"] == {
        "code": "transaction.currency_must_match_source_account",
        "params": {"expected": "USD", "received": "BRL"},
    }


async def test_update_transfer_revalidates_source_currency(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "update-transfer-currency@example.com")
    source_id = await _create_account(client, name="Source")
    dest_id = await _create_account(client, name="Destination")
    created = await client.post(
        "/api/v1/transactions",
        json={
            "type": "transfer",
            "date": "2026-01-10",
            "amount": "200.00",
            "currency": "BRL",
            "account_id": source_id,
            "to_account_id": dest_id,
            "description": "Valid transfer",
        },
    )

    response = await client.patch(
        f"/api/v1/transactions/{created.json()['id']}", json={"currency": "USD"}
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.currency_must_match_source_account"


async def test_create_interest_transaction(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "dave@example.com")
    account_id = await _create_account(client, name="Savings")

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "interest",
            "date": "2026-01-31",
            "amount": "5.00",
            "currency": "BRL",
            "account_id": account_id,
            "description": "Monthly interest",
        },
    )
    assert response.status_code == 201


async def test_amount_must_be_positive(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "erin@example.com")
    account_id = await _create_account(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "interest",
            "date": "2026-01-31",
            "amount": "0",
            "currency": "BRL",
            "account_id": account_id,
            "description": "Zero",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "error.validation"


async def test_transfer_to_same_account_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "frank@example.com")
    account_id = await _create_account(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "transfer",
            "date": "2026-01-10",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "to_account_id": account_id,
            "description": "Self transfer",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.transfer_same_account"


async def test_transfer_with_category_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "grace@example.com")
    source_id = await _create_account(client, name="Checking")
    dest_id = await _create_account(client, name="Savings")
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "transfer",
            "date": "2026-01-10",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": source_id,
            "to_account_id": dest_id,
            "category_id": category_id,
            "description": "Bad transfer",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.transfer_has_category"


async def test_interest_with_category_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "heidi@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "interest",
            "date": "2026-01-31",
            "amount": "5.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Bad interest",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.interest_has_category"


async def test_income_without_category_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "ivan@example.com")
    account_id = await _create_account(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "income",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "description": "No category",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.category_required"


async def test_expense_with_income_category_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "judy@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client, name="Salary", kind="income")

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Mismatched",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.category_kind_mismatch"


async def test_destination_not_allowed_for_non_transfer(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "kate@example.com")
    account_id = await _create_account(client)
    other_account_id = await _create_account(client, name="Other")
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "to_account_id": other_account_id,
            "category_id": category_id,
            "description": "Should not have destination",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.destination_not_allowed"


async def test_transaction_with_foreign_account_is_not_found(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "leo@example.com")
    await _authed(other_client, db_session, "mallory@example.com")
    account_id = await _create_account(client)

    response = await other_client.post(
        "/api/v1/transactions",
        json={
            "type": "interest",
            "date": "2026-01-01",
            "amount": "10.00",
            "currency": "BRL",
            "account_id": account_id,
            "description": "Sneaky",
        },
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "account.not_found"


async def test_cross_currency_transaction_requires_conversion(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "niaj@example.com")
    account_id = await _create_account(client, currency="USD")
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Cross currency",
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.conversion_required"


async def test_same_currency_transaction_rejects_conversion(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "olivia@example.com")
    account_id = await _create_account(client, currency="BRL")
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "No conversion needed",
            "conversion": {"currency": "BRL", "rate": "1.0", "source": "manual"},
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.conversion_not_needed"


async def test_conversion_currency_must_match_destination(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "peggy@example.com")
    account_id = await _create_account(client, currency="USD")
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Wrong conversion currency",
            "conversion": {"currency": "EUR", "rate": "5.0", "source": "manual"},
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.conversion_currency_mismatch"


async def test_conversion_amount_is_computed_when_omitted(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "quentin@example.com")
    account_id = await _create_account(client, currency="USD")
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Computed conversion",
            "conversion": {"currency": "USD", "rate": "0.2", "source": "manual"},
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["conversion"]["amount"] == "20.0000"
    assert body["conversion"]["source"] == "manual"


async def test_conversion_fee_deducted_before_rate(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "romeo@example.com")
    account_id = await _create_account(client, currency="USD")
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Fee then rate",
            "conversion": {"currency": "USD", "fee": "10.00", "rate": "0.2", "source": "manual"},
        },
    )
    assert response.status_code == 201
    # (100 - 10) * 0.2 = 18.00
    assert response.json()["conversion"]["amount"] == "18.0000"


async def test_conversion_amount_mismatch_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "sybil@example.com")
    account_id = await _create_account(client, currency="USD")
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Bad amount",
            "conversion": {
                "amount": "999.00",
                "currency": "USD",
                "rate": "0.2",
                "source": "manual",
            },
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.conversion_mismatch"


async def test_conversion_fee_exceeding_amount_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "trent@example.com")
    account_id = await _create_account(client, currency="USD")
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Fee too big",
            "conversion": {"fee": "200.00", "currency": "USD", "rate": "0.2", "source": "manual"},
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.conversion_fee_exceeds_amount"


async def test_conversion_fee_equal_to_amount_is_rejected(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "full-fee@example.com")
    account_id = await _create_account(client, currency="USD")
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "No proceeds",
            "conversion": {
                "fee": "100.00",
                "currency": "USD",
                "rate": "0.2",
                "source": "manual",
            },
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.conversion_fee_exceeds_amount"


async def test_supplied_conversion_amount_must_be_positive(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "non-positive-conversion@example.com")
    account_id = await _create_account(client, currency="USD")
    category_id = await _create_category(client)

    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "100.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Invalid converted amount",
            "conversion": {
                "amount": "0",
                "currency": "USD",
                "rate": "0.2",
                "source": "manual",
            },
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.conversion_amount_not_positive"


async def test_get_and_update_transaction(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "uma@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    create_response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "50.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Original",
        },
    )
    transaction_id = create_response.json()["id"]

    get_response = await client.get(f"/api/v1/transactions/{transaction_id}")
    assert get_response.status_code == 200
    assert get_response.json()["description"] == "Original"

    update_response = await client.patch(
        f"/api/v1/transactions/{transaction_id}", json={"amount": "75.00"}
    )
    assert update_response.status_code == 200
    assert update_response.json()["amount"] == "75.0000"


async def test_update_transaction_revalidates_category_kind(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "victor@example.com")
    account_id = await _create_account(client)
    expense_category_id = await _create_category(client, name="Groceries", kind="expense")
    income_category_id = await _create_category(client, name="Salary", kind="income")
    create_response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "50.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": expense_category_id,
            "description": "Original",
        },
    )
    transaction_id = create_response.json()["id"]

    response = await client.patch(
        f"/api/v1/transactions/{transaction_id}", json={"category_id": income_category_id}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.category_kind_mismatch"


async def test_delete_transaction(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "wendy@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    create_response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "50.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Deletable",
        },
    )
    transaction_id = create_response.json()["id"]

    delete_response = await client.delete(f"/api/v1/transactions/{transaction_id}")
    assert delete_response.status_code == 204

    get_response = await client.get(f"/api/v1/transactions/{transaction_id}")
    assert get_response.status_code == 404


async def test_list_transactions_filters_by_type_and_account(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "xena@example.com")
    account_a = await _create_account(client, name="A")
    account_b = await _create_account(client, name="B")
    expense_category = await _create_category(client, name="Groceries", kind="expense")
    income_category = await _create_category(client, name="Salary", kind="income")

    await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-05",
            "amount": "20.00",
            "currency": "BRL",
            "account_id": account_a,
            "category_id": expense_category,
            "description": "A expense",
        },
    )
    await client.post(
        "/api/v1/transactions",
        json={
            "type": "income",
            "date": "2026-01-10",
            "amount": "500.00",
            "currency": "BRL",
            "account_id": account_b,
            "category_id": income_category,
            "description": "B income",
        },
    )

    by_type = await client.get("/api/v1/transactions", params={"type": "income"})
    assert by_type.status_code == 200
    assert all(row["type"] == "income" for row in by_type.json())

    by_account = await client.get("/api/v1/transactions", params={"account_id": account_a})
    assert by_account.status_code == 200
    assert all(row["account_id"] == account_a for row in by_account.json())

    by_date = await client.get(
        "/api/v1/transactions", params={"date_from": "2026-01-08", "date_to": "2026-01-31"}
    )
    assert by_date.status_code == 200
    assert all(row["date"] >= "2026-01-08" for row in by_date.json())


async def test_transaction_ownership_isolation(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "yara@example.com")
    await _authed(other_client, db_session, "zack@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    create_response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-01",
            "amount": "50.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": "Yara's transaction",
        },
    )
    transaction_id = create_response.json()["id"]

    get_response = await other_client.get(f"/api/v1/transactions/{transaction_id}")
    assert get_response.status_code == 404
    assert get_response.json()["error"]["code"] == "transaction.not_found"

    list_response = await other_client.get("/api/v1/transactions")
    assert all(row["id"] != transaction_id for row in list_response.json())


async def test_list_transactions_filters_by_search_and_institution(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "ines@example.com")
    institution_response = await client.post(
        "/api/v1/institutions", json={"name": "Bank A", "icon": "bank"}
    )
    assert institution_response.status_code == 201, institution_response.text
    institution_id = institution_response.json()["id"]

    linked_response = await client.post(
        "/api/v1/accounts",
        json={
            "name": "Linked",
            "type": "checking",
            "currency": "BRL",
            "institution_id": institution_id,
        },
    )
    assert linked_response.status_code == 201, linked_response.text
    linked_account = linked_response.json()["id"]
    unlinked_account = await _create_account(client, name="Unlinked")
    category_id = await _create_category(client)

    await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-05",
            "amount": "20.00",
            "currency": "BRL",
            "account_id": linked_account,
            "category_id": category_id,
            "description": "Coffee shop run",
        },
    )
    await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-06",
            "amount": "30.00",
            "currency": "BRL",
            "account_id": unlinked_account,
            "category_id": category_id,
            "description": "Grocery store",
        },
    )

    by_search = await client.get("/api/v1/transactions", params={"search": "coffee"})
    assert by_search.status_code == 200
    assert [row["description"] for row in by_search.json()] == ["Coffee shop run"]

    by_institution = await client.get(
        "/api/v1/transactions", params={"institution_id": institution_id}
    )
    assert by_institution.status_code == 200
    assert [row["account_id"] for row in by_institution.json()] == [linked_account]


async def test_list_transactions_filters_by_repeated_type(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "jorge@example.com")
    account_id = await _create_account(client)
    expense_category = await _create_category(client, name="Groceries", kind="expense")
    income_category = await _create_category(client, name="Salary", kind="income")

    await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": "2026-01-05",
            "amount": "20.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": expense_category,
            "description": "Expense row",
        },
    )
    await client.post(
        "/api/v1/transactions",
        json={
            "type": "income",
            "date": "2026-01-06",
            "amount": "500.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": income_category,
            "description": "Income row",
        },
    )
    await client.post(
        "/api/v1/transactions",
        json={
            "type": "interest",
            "date": "2026-01-07",
            "amount": "1.00",
            "currency": "BRL",
            "account_id": account_id,
            "description": "Interest row",
        },
    )

    response = await client.get("/api/v1/transactions", params={"type": ["income", "expense"]})
    assert response.status_code == 200
    types = {row["type"] for row in response.json()}
    assert types == {"income", "expense"}


async def test_list_transactions_pages_without_gaps_or_duplicates(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "karin@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)

    # All on the same date, so the id tiebreaker is what keeps paging stable.
    created_ids = []
    for i in range(5):
        response = await client.post(
            "/api/v1/transactions",
            json={
                "type": "expense",
                "date": "2026-01-05",
                "amount": f"{i + 1}.00",
                "currency": "BRL",
                "account_id": account_id,
                "category_id": category_id,
                "description": f"Row {i}",
            },
        )
        created_ids.append(response.json()["id"])

    page1 = await client.get("/api/v1/transactions", params={"limit": 2, "offset": 0})
    page2 = await client.get("/api/v1/transactions", params={"limit": 2, "offset": 2})
    page3 = await client.get("/api/v1/transactions", params={"limit": 2, "offset": 4})

    ids_seen = (
        [row["id"] for row in page1.json()]
        + [row["id"] for row in page2.json()]
        + [row["id"] for row in page3.json()]
    )
    assert len(ids_seen) == len(set(ids_seen)) == 5
    assert set(ids_seen) == set(created_ids)
    assert len(page3.json()) == 1
