"""Portable backup export, preview, and atomic restore."""

from copy import deepcopy
from datetime import date
from decimal import Decimal
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Account,
    AgentCredential,
    Budget,
    BudgetAllocation,
    CategorizationRule,
    Category,
    CategoryGroup,
    ExpectedIncome,
    Goal,
    Institution,
    InvestmentAsset,
    InvestmentTransaction,
    InvestmentWallet,
    Loan,
    ManualRate,
    MarketDataCredential,
    RecurringRule,
    Session,
    Transaction,
)
from app.models.base import Base, UserOwnedModel
from app.services import backups
from tests.factories import login_as, make_user


async def _authenticated(
    client: AsyncClient, db: AsyncSession, *, email: str = "backup@example.com"
):
    user, password = await make_user(db, email=email)
    await login_as(client, email=user.email, password=password)
    return user


async def _seed_complete_graph(db: AsyncSession, user_id: UUID) -> None:
    institution = Institution(
        user_id=user_id, name="Bank", icon="bank", color="#112233", position=1
    )
    expense_group = CategoryGroup(
        user_id=user_id,
        name="Housing",
        kind="expense",
        color="#334455",
        icon="home",
        position=0,
    )
    db.add_all([institution, expense_group])
    await db.flush()

    cash = Account(
        user_id=user_id,
        name="Cash",
        type="checking",
        currency="BRL",
        opening_balance=Decimal("123456789012345.4567"),
        institution_id=institution.id,
    )
    goal_account = Account(
        user_id=user_id,
        name="Goal account",
        type="goal",
        currency="BRL",
        opening_balance=Decimal("0.0000"),
    )
    investment_account = Account(
        user_id=user_id,
        name="Brokerage",
        type="investment",
        currency="BRL",
        opening_balance=Decimal("0.0000"),
        institution_id=institution.id,
    )
    category = Category(
        user_id=user_id,
        name="Rent",
        kind="expense",
        group_id=expense_group.id,
        color="#556677",
        icon="home",
        position=0,
    )
    db.add_all([cash, goal_account, investment_account, category])
    await db.flush()

    rule = CategorizationRule(
        user_id=user_id,
        name="Rent rule",
        priority=10,
        is_active=True,
        match_op="and",
        conditions=[{"field": "description", "operator": "contains", "value": "Rent"}],
        category_id=category.id,
    )
    budget = Budget(
        user_id=user_id,
        group_id=expense_group.id,
        month="2026-08",
        amount=Decimal("2500.1250"),
        currency="BRL",
    )
    allocation = BudgetAllocation(
        user_id=user_id, group_id=expense_group.id, percentage=Decimal("42.1250")
    )
    income = ExpectedIncome(
        user_id=user_id, month="2026-08", amount=Decimal("8000.0000"), currency="BRL"
    )
    recurring = RecurringRule(
        user_id=user_id,
        frequency="monthly",
        interval=1,
        start_date=date(2026, 1, 1),
        template_type="expense",
        template_amount=Decimal("100.0000"),
        template_currency="BRL",
        template_account_id=cash.id,
        template_category_id=category.id,
        template_description="Rent",
    )
    loan = Loan(
        user_id=user_id,
        name="Home loan",
        category_id=category.id,
        currency="BRL",
        amount_borrowed=Decimal("10000.0000"),
        fees=Decimal("100.0000"),
        interest_rate=Decimal("1.2500"),
        rate_period="monthly",
        installment_count=12,
        installment_amount=Decimal("901.2345"),
        first_payment_date=date(2026, 1, 15),
        payment_account_id=cash.id,
    )
    goal = Goal(
        user_id=user_id,
        account_id=goal_account.id,
        name="Emergency fund",
        target_amount=Decimal("5000.0000"),
        currency="BRL",
        target_date=date(2027, 1, 1),
    )
    manual_rate = ManualRate(
        user_id=user_id,
        base_code="BRL",
        quote_code="USD",
        rate=Decimal("0.1834567890"),
        as_of=date(2026, 8, 31),
    )
    wallet = InvestmentWallet(
        user_id=user_id,
        account_id=investment_account.id,
        name="Brokerage wallet",
        currency="BRL",
        cash_account_id=cash.id,
        institution_id=institution.id,
    )
    asset = InvestmentAsset(
        user_id=user_id,
        symbol="LEAL3",
        name="Leal Corp",
        asset_class="stock",
        currency="BRL",
        quote_provider="manual",
        manual_price=Decimal("12.3456789000"),
    )
    db.add_all(
        [rule, budget, allocation, income, recurring, loan, goal, manual_rate, wallet, asset]
    )
    await db.flush()

    transaction = Transaction(
        user_id=user_id,
        type="expense",
        date=date(2026, 8, 31),
        amount=Decimal("100.1234"),
        currency="BRL",
        account_id=cash.id,
        category_id=category.id,
        description="Rent payment",
        recurring_rule_id=recurring.id,
        loan_id=loan.id,
    )
    db.add(transaction)
    await db.flush()
    db.add(
        InvestmentTransaction(
            user_id=user_id,
            wallet_id=wallet.id,
            asset_id=asset.id,
            type="buy",
            date=date(2026, 8, 31),
            quantity=Decimal("2.5000000000"),
            price=Decimal("12.3456789000"),
            amount=Decimal("30.8642"),
            fee=Decimal("0.1000"),
            currency="BRL",
            transaction_id=transaction.id,
        )
    )
    await db.commit()


def _error_code(response) -> str:
    return response.json()["error"]["code"]


def test_every_user_owned_model_is_included_or_explicitly_excluded() -> None:
    included = {table.model for table in backups.BACKUP_TABLES}
    excluded = set(backups.EXCLUDED_USER_OWNED_MODELS)
    owned = {
        mapper.class_
        for mapper in Base.registry.mappers
        if issubclass(mapper.class_, UserOwnedModel)
    }
    assert included.isdisjoint(excluded)
    assert included | excluded == owned


async def test_plain_preview_rolls_back_and_restore_replaces_only_current_user(
    client: AsyncClient, other_client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authenticated(client, db_session)
    other = await _authenticated(other_client, db_session, email="other-backup@example.com")
    await _seed_complete_graph(db_session, user.id)
    other_institution = Institution(user_id=other.id, name="Other bank", icon="bank", position=0)
    credential = AgentCredential(
        user_id=user.id, provider="ollama", auth_mode="none", base_url="http://ollama:11434"
    )
    market_credential = MarketDataCredential(
        user_id=user.id, provider="brapi", secret_ciphertext="keep-me"
    )
    db_session.add_all([other_institution, credential, market_credential])
    user.locale = "pt-BR"
    user.theme = "dark"
    user.base_currency = "BRL"
    user.display_currency = "USD"
    user.investments_enabled = True
    user.balances_hidden = True
    await db_session.commit()
    identity = (user.email, user.password_hash, user.role)
    session_ids = set(
        (await db_session.scalars(select(Session.id).where(Session.user_id == user.id))).all()
    )

    exported = await client.post("/api/v1/backups/export", json={"encrypted": False})
    assert exported.status_code == 200, exported.text
    body = exported.json()
    archive = body["archive"]
    assert body["recovery_key"] is None
    assert body["filename"].endswith(".json")
    assert archive["format_version"] == 1
    cash_row = next(
        row for row in archive["payload"]["data"]["accounts"]["rows"] if row["name"] == "Cash"
    )
    assert cash_row["opening_balance"] == "123456789012345.4567"
    assert "agent_credentials" in archive["payload"]["omissions"]

    old_ids = {
        table.name: {UUID(row["id"]) for row in archive["payload"]["data"][table.name]["rows"]}
        for table in backups.BACKUP_TABLES
    }
    extra = Institution(user_id=user.id, name="Preview survivor", icon="bank", position=9)
    db_session.add(extra)
    user.locale = "en-US"
    user.theme = "light"
    await db_session.commit()

    preview = await client.post("/api/v1/backups/preview", json={"archive": archive})
    assert preview.status_code == 200, preview.text
    preview_body = preview.json()
    assert preview_body["source_app_version"] == "dev"
    assert preview_body["counts"]["investment_transactions"] == 1
    assert preview_body["warnings"] == [{"code": "credentials_reconnect", "params": {}}]
    assert (
        await db_session.scalar(
            select(func.count(Institution.id)).where(Institution.user_id == user.id)
        )
        == 2
    )
    await db_session.refresh(user)
    assert (user.locale, user.theme) == ("en-US", "light")

    restored = await client.post("/api/v1/backups/restore", json={"archive": archive})
    assert restored.status_code == 200, restored.text
    for table in backups.BACKUP_TABLES:
        rows = list(
            (
                await db_session.scalars(select(table.model).where(table.model.user_id == user.id))
            ).all()
        )
        assert len(rows) == restored.json()["counts"][table.name]
        assert {row.id for row in rows}.isdisjoint(old_ids[table.name])

    restored_transaction = (
        await db_session.scalars(select(Transaction).where(Transaction.user_id == user.id))
    ).one()
    restored_investment = (
        await db_session.scalars(
            select(InvestmentTransaction).where(InvestmentTransaction.user_id == user.id)
        )
    ).one()
    assert restored_investment.transaction_id == restored_transaction.id
    assert restored_transaction.amount == Decimal("100.1234")
    restored_account = (
        await db_session.scalars(
            select(Account).where(Account.user_id == user.id, Account.name == "Cash")
        )
    ).one()
    assert restored_account.opening_balance == Decimal("123456789012345.4567")

    await db_session.refresh(user)
    assert (user.locale, user.theme, user.base_currency, user.display_currency) == (
        "pt-BR",
        "dark",
        "BRL",
        "USD",
    )
    assert (user.email, user.password_hash, user.role) == identity
    assert (
        set((await db_session.scalars(select(Session.id).where(Session.user_id == user.id))).all())
        == session_ids
    )
    assert await db_session.get(AgentCredential, credential.id) is not None
    assert (await db_session.get(MarketDataCredential, market_credential.id)).secret_ciphertext == (
        "keep-me"
    )
    assert await db_session.get(Institution, other_institution.id) is not None


async def test_encrypted_round_trip_and_key_failures(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user = await _authenticated(client, db_session, email="encrypted@example.com")
    original = Institution(user_id=user.id, name="Encrypted bank", icon="bank", position=0)
    db_session.add(original)
    await db_session.commit()

    exported = (await client.post("/api/v1/backups/export", json={"encrypted": True})).json()
    archive = exported["archive"]
    key = exported["recovery_key"]
    assert archive["encrypted"] is True
    assert archive["cipher"] == "fernet"
    assert isinstance(archive["payload"], str)

    missing = await client.post("/api/v1/backups/preview", json={"archive": archive})
    wrong = await client.post(
        "/api/v1/backups/preview", json={"archive": archive, "recovery_key": "not-a-key"}
    )
    tampered_archive = deepcopy(archive)
    token = tampered_archive["payload"]
    tampered_archive["payload"] = token[:-1] + ("A" if token[-1] != "A" else "B")
    tampered = await client.post(
        "/api/v1/backups/preview",
        json={"archive": tampered_archive, "recovery_key": key},
    )
    assert _error_code(missing) == "backup.recovery_key_required"
    assert _error_code(wrong) == _error_code(tampered) == "backup.recovery_key_invalid"

    original.name = "Changed"
    await db_session.commit()
    restored = await client.post(
        "/api/v1/backups/restore", json={"archive": archive, "recovery_key": key}
    )
    assert restored.status_code == 200, restored.text
    names = set(
        (
            await db_session.scalars(select(Institution.name).where(Institution.user_id == user.id))
        ).all()
    )
    assert names == {"Encrypted bank"}


async def test_archive_validation_versions_warnings_and_atomic_failure(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    user = await _authenticated(client, db_session, email="validation-backup@example.com")
    institution = Institution(user_id=user.id, name="Must survive", icon="bank", position=0)
    db_session.add(institution)
    await db_session.commit()
    institution_id = institution.id
    archive = (await client.post("/api/v1/backups/export", json={})).json()["archive"]

    invalid = await client.post("/api/v1/backups/preview", json={"archive": []})
    assert _error_code(invalid) == "backup.invalid_archive"

    monkeypatch.setattr(backups, "MAX_ARCHIVE_BYTES", 10)
    oversized = await client.post("/api/v1/backups/preview", json={"archive": archive})
    assert _error_code(oversized) == "backup.file_too_large"
    monkeypatch.setattr(backups, "MAX_ARCHIVE_BYTES", 25 * 1024 * 1024)

    old_app_archive = deepcopy(archive)
    old_app_archive["payload"]["app_version"] = "0.2.0"
    accepted = await client.post("/api/v1/backups/preview", json={"archive": old_app_archive})
    assert accepted.status_code == 200, accepted.text
    newer_format = deepcopy(archive)
    newer_format["format_version"] = 2
    rejected = await client.post("/api/v1/backups/preview", json={"archive": newer_format})
    assert _error_code(rejected) == "backup.version_unsupported"

    obsolete = deepcopy(archive)
    obsolete["payload"]["preferences"]["demo_data_enabled"] = True
    warning = await client.post("/api/v1/backups/preview", json={"archive": obsolete})
    assert warning.json()["warnings"] == [
        {"code": "obsolete_setting_skipped", "params": {"setting": "demo_data_enabled"}}
    ]

    incompatible = deepcopy(archive)
    incompatible["payload"]["data"]["institutions"]["rows"][0]["name"] = None
    failed = await client.post("/api/v1/backups/restore", json={"archive": incompatible})
    assert failed.status_code == 422
    assert _error_code(failed) == "backup.data_incompatible"
    survivor = await db_session.get(Institution, institution_id)
    assert survivor is not None
    assert survivor.name == "Must survive"
