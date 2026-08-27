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


async def _create_group(client: AsyncClient, name: str, kind: str = "expense") -> str:
    response = await client.post(
        "/api/v1/category-groups",
        json={"name": name, "kind": kind, "color": "#112233", "icon": "tag"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _create_category_in_group(
    client: AsyncClient, name: str, group_id: str, kind: str = "expense"
) -> str:
    response = await client.post(
        "/api/v1/categories",
        json={"name": name, "kind": kind, "group_id": group_id, "color": "#112233", "icon": "tag"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _post_expense(
    client: AsyncClient,
    account_id: str,
    category_id: str,
    *,
    date: str = "2026-01-05",
    amount: str = "10.00",
    description: str = "Row",
) -> str:
    response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "expense",
            "date": date,
            "amount": amount,
            "currency": "BRL",
            "account_id": account_id,
            "category_id": category_id,
            "description": description,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def test_list_transactions_total_count_header_reflects_filters(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "tot@example.com")
    account_id = await _create_account(client)
    expense_category = await _create_category(client, name="Groceries", kind="expense")
    income_category = await _create_category(client, name="Salary", kind="income")

    for i in range(5):
        await _post_expense(client, account_id, expense_category, description=f"Row {i}")
    await client.post(
        "/api/v1/transactions",
        json={
            "type": "income",
            "date": "2026-01-06",
            "amount": "500.00",
            "currency": "BRL",
            "account_id": account_id,
            "category_id": income_category,
            "description": "Paycheck",
        },
    )

    paged = await client.get("/api/v1/transactions", params={"limit": 2, "offset": 0})
    assert paged.status_code == 200
    assert paged.headers["X-Total-Count"] == "6"
    assert len(paged.json()) == 2

    filtered = await client.get("/api/v1/transactions", params={"limit": 2, "type": "expense"})
    assert filtered.headers["X-Total-Count"] == "5"


async def test_list_transactions_sort_by_amount_ascending(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "sortamt@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    for amount in ("30.00", "10.00", "20.00"):
        await _post_expense(client, account_id, category_id, amount=amount)

    response = await client.get("/api/v1/transactions", params={"sort": "amount", "order": "asc"})
    assert response.status_code == 200
    assert [row["amount"] for row in response.json()] == ["10.0000", "20.0000", "30.0000"]


async def test_list_transactions_sort_by_description_is_stable_across_pages(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "sortdesc@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    # Same description on every row, so the id tiebreaker carries the ordering.
    created = [
        await _post_expense(client, account_id, category_id, description="Same") for _ in range(5)
    ]

    seen: list[str] = []
    for offset in (0, 2, 4):
        page = await client.get(
            "/api/v1/transactions",
            params={"sort": "description", "order": "asc", "limit": 2, "offset": offset},
        )
        seen.extend(row["id"] for row in page.json())
    assert len(seen) == len(set(seen)) == 5
    assert set(seen) == set(created)


async def test_list_transactions_rejects_unknown_sort(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "badsort@example.com")
    response = await client.get("/api/v1/transactions", params={"sort": "bogus"})
    assert response.status_code == 422


async def test_list_transactions_filters_by_group(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "grp@example.com")
    account_id = await _create_account(client)
    group_a = await _create_group(client, "Group A")
    group_b = await _create_group(client, "Group B")
    cat_a1 = await _create_category_in_group(client, "A1", group_a)
    cat_a2 = await _create_category_in_group(client, "A2", group_a)
    cat_b1 = await _create_category_in_group(client, "B1", group_b)

    await _post_expense(client, account_id, cat_a1, description="in A1")
    await _post_expense(client, account_id, cat_a2, description="in A2")
    await _post_expense(client, account_id, cat_b1, description="in B1")

    response = await client.get("/api/v1/transactions", params={"group_id": group_a})
    assert response.status_code == 200
    assert {row["description"] for row in response.json()} == {"in A1", "in A2"}


async def test_list_transactions_group_filter_rejects_foreign_group(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "grpowner@example.com")
    await _authed(other_client, db_session, "grpother@example.com")
    foreign_group = await _create_group(other_client, "Foreign")

    response = await client.get("/api/v1/transactions", params={"group_id": foreign_group})
    assert response.status_code == 404


async def test_list_transactions_filters_by_amount_range(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "amtrange@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    for amount in ("5.00", "10.00", "20.00", "50.00"):
        await _post_expense(client, account_id, category_id, amount=amount)

    response = await client.get(
        "/api/v1/transactions", params={"amount_min": "10", "amount_max": "20"}
    )
    assert response.status_code == 200
    assert sorted(row["amount"] for row in response.json()) == ["10.0000", "20.0000"]


async def test_bulk_delete_removes_every_id(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "bulkdel@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    ids = [await _post_expense(client, account_id, category_id) for _ in range(3)]

    response = await client.post("/api/v1/transactions/bulk-delete", json={"ids": ids})
    assert response.status_code == 204

    remaining = await client.get("/api/v1/transactions")
    assert remaining.json() == []


async def test_bulk_delete_rejects_foreign_id_and_deletes_nothing(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bulkdelowner@example.com")
    await _authed(other_client, db_session, "bulkdelother@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    mine = await _post_expense(client, account_id, category_id)

    foreign_account = await _create_account(other_client)
    foreign_category = await _create_category(other_client)
    theirs = await _post_expense(other_client, foreign_account, foreign_category)

    response = await client.post("/api/v1/transactions/bulk-delete", json={"ids": [mine, theirs]})
    assert response.status_code == 404
    assert len((await client.get("/api/v1/transactions")).json()) == 1


async def test_bulk_delete_rejects_empty_ids(client: AsyncClient, db_session: AsyncSession) -> None:
    await _authed(client, db_session, "bulkempty@example.com")
    response = await client.post("/api/v1/transactions/bulk-delete", json={"ids": []})
    assert response.status_code == 422


async def test_bulk_categorize_assigns_category(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bulkcat@example.com")
    account_id = await _create_account(client)
    old_category = await _create_category(client, name="Groceries", kind="expense")
    new_category = await _create_category(client, name="Dining", kind="expense")
    ids = [await _post_expense(client, account_id, old_category) for _ in range(2)]

    response = await client.post(
        "/api/v1/transactions/bulk-categorize",
        json={"ids": ids, "category_id": new_category},
    )
    assert response.status_code == 200
    assert response.json()["updated"] == 2
    rows = (await client.get("/api/v1/transactions")).json()
    assert {row["category_id"] for row in rows} == {new_category}


async def test_bulk_categorize_rejects_transfer_and_changes_nothing(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bulkcattransfer@example.com")
    account_a = await _create_account(client, name="A")
    account_b = await _create_account(client, name="B")
    category_id = await _create_category(client, name="Groceries", kind="expense")
    expense_id = await _post_expense(client, account_a, category_id)
    transfer_response = await client.post(
        "/api/v1/transactions",
        json={
            "type": "transfer",
            "date": "2026-01-05",
            "amount": "15.00",
            "currency": "BRL",
            "account_id": account_a,
            "to_account_id": account_b,
            "description": "Move money",
        },
    )
    transfer_id = transfer_response.json()["id"]

    response = await client.post(
        "/api/v1/transactions/bulk-categorize",
        json={"ids": [expense_id, transfer_id], "category_id": category_id},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.transfer_has_category"
    expense_row = (await client.get(f"/api/v1/transactions/{expense_id}")).json()
    assert expense_row["category_id"] == category_id


async def test_bulk_categorize_rejects_kind_mismatch(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "bulkcatkind@example.com")
    account_id = await _create_account(client)
    expense_category = await _create_category(client, name="Groceries", kind="expense")
    income_category = await _create_category(client, name="Salary", kind="income")
    expense_id = await _post_expense(client, account_id, expense_category)

    response = await client.post(
        "/api/v1/transactions/bulk-categorize",
        json={"ids": [expense_id], "category_id": income_category},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "transaction.category_kind_mismatch"


async def test_bulk_routes_do_not_shadow_transaction_id(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _authed(client, db_session, "shadow@example.com")
    account_id = await _create_account(client)
    category_id = await _create_category(client)
    transaction_id = await _post_expense(client, account_id, category_id)

    response = await client.get(f"/api/v1/transactions/{transaction_id}")
    assert response.status_code == 200
    assert response.json()["id"] == transaction_id


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
