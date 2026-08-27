"""Interactive local dev-data generator.

Builds one plausible user - institutions, accounts (incl. a credit card
and a goal), categories, transactions, budgets, a recurring rule
history, and an investment wallet (two manual-priced assets, a
buy/sell/dividend/fee history, cash-settled against checking) - so a
developer has something to look at without hand-creating it through the
UI. Every value is prompted with a sensible default; pressing Enter at
every prompt gives a usable database.

Run from backend/, after `alembic upgrade head` (every currency column is
a real FK, so currencies must already exist):

    uv run python -m scripts.seed          # interactive
    uv run python -m scripts.seed -y       # accept every default

Re-running wipes the target user (FK CASCADE removes everything they
own) and rebuilds - deterministic for a given RNG seed, so two runs with
the same answers produce an identical database.

Data is written through the same service-layer functions the API uses
(create_account, create_transaction, post_due_occurrences, ...) rather
than raw ORM inserts - that's what already implements conversion
arithmetic, ownership checks, and CHECK-constraint-shaped validation, so
this script doesn't re-derive any of it.
"""

import argparse
import asyncio
import calendar
import random
import re
import sys
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

# Must precede any app import - see app/dev.py's docstring for why.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from sqlalchemy import func, select  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.db import session_scope  # noqa: E402
from app.core.security import hash_password, normalize_email  # noqa: E402
from app.models._conversion import CONVERSION_SOURCE_MANUAL  # noqa: E402
from app.models.account import (  # noqa: E402
    ACCOUNT_TYPE_CASH,
    ACCOUNT_TYPE_CHECKING,
    ACCOUNT_TYPE_CREDIT_CARD,
    ACCOUNT_TYPE_SAVINGS,
    Account,
)
from app.models.budget import BudgetAllocation  # noqa: E402
from app.models.category import CATEGORY_KIND_EXPENSE, CATEGORY_KIND_INCOME, Category  # noqa: E402
from app.models.category_group import CategoryGroup  # noqa: E402
from app.models.institution import Institution  # noqa: E402
from app.models.investment import (  # noqa: E402
    ASSET_CLASS_ETF,
    ASSET_CLASS_STOCK,
    INVESTMENT_TRANSACTION_TYPE_BUY,
    INVESTMENT_TRANSACTION_TYPE_DIVIDEND,
    INVESTMENT_TRANSACTION_TYPE_FEE,
    INVESTMENT_TRANSACTION_TYPE_SELL,
    QUOTE_PROVIDER_MANUAL,
)
from app.models.recurring import (  # noqa: E402
    RECURRING_FREQUENCY_MONTHLY,
    RECURRING_FREQUENCY_YEARLY,
)
from app.models.transaction import (  # noqa: E402
    TRANSACTION_TYPE_EXPENSE,
    TRANSACTION_TYPE_INCOME,
    TRANSACTION_TYPE_INTEREST,
    TRANSACTION_TYPE_TRANSFER,
    Transaction,
)
from app.models.user import ROLE_ADMIN, User  # noqa: E402
from app.schemas.account import AccountCreate  # noqa: E402
from app.schemas.budget import BudgetUpsert  # noqa: E402
from app.schemas.budget_plan import BudgetAllocationUpsert, ExpectedIncomeUpsert  # noqa: E402
from app.schemas.category import CategoryCreate  # noqa: E402
from app.schemas.category_group import CategoryGroupCreate  # noqa: E402
from app.schemas.goal import GoalWithAccountCreate  # noqa: E402
from app.schemas.institution import InstitutionCreate  # noqa: E402
from app.schemas.investment import (  # noqa: E402
    InvestmentAssetCreate,
    InvestmentTransactionCreate,
    InvestmentWalletCreate,
)
from app.schemas.recurring import RecurringRuleCreate, RecurringTemplateInput  # noqa: E402
from app.schemas.transaction import ConversionInput, TransactionCreate  # noqa: E402
from app.services import category_groups as category_groups_service  # noqa: E402
from app.services import investments as investments_service  # noqa: E402
from app.services.accounts import account_balances, create_account  # noqa: E402
from app.services.budget_plan import upsert_allocation, upsert_expected_income  # noqa: E402
from app.services.budgets import upsert_budget  # noqa: E402
from app.services.categories import create_category  # noqa: E402
from app.services.currencies import get_active_currency  # noqa: E402
from app.services.goals import create_goal_with_account  # noqa: E402
from app.services.institutions import create_institution  # noqa: E402
from app.services.manual_rates import upsert_manual_rate  # noqa: E402
from app.services.recurrence import add_months_clamped  # noqa: E402
from app.services.recurring_posting import post_due_occurrences  # noqa: E402
from app.services.recurring_rules import create_recurring_rule  # noqa: E402
from app.services.transactions import create_transaction  # noqa: E402

# --- Prompting -----------------------------------------------------------------

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def ask(label: str, default: str, use_default: bool) -> str:
    if use_default:
        return default
    raw = input(f"{label} [{default}]: ").strip()
    return raw or default


def ask_int(label: str, default: int, use_default: bool) -> int:
    while True:
        raw = ask(label, str(default), use_default)
        try:
            return int(raw)
        except ValueError:
            print("  expected a whole number, try again")


def ask_bool(label: str, default: bool, use_default: bool) -> bool:
    raw = ask(label, "yes" if default else "no", use_default)
    return raw.strip().lower() in {"y", "yes", "true", "1"}


def ask_month(label: str, default: str, use_default: bool) -> str:
    while True:
        raw = ask(label, default, use_default)
        if _MONTH_RE.match(raw):
            return raw
        print("  expected YYYY-MM, try again")


@dataclass(frozen=True)
class Config:
    email: str
    password: str
    display_name: str
    base_currency: str
    display_currency: str
    secondary_currency: str
    start_month: str
    end_month: str
    tx_per_month: int
    institutions_count: int
    accounts_count: int
    rng_seed: int
    wipe: bool


def prompt_config(use_defaults: bool) -> Config:
    today = date.today()
    default_start = month_str(add_months_clamped(today, -12))
    default_end = month_str(today)

    email = ask("Email", "dev@lealfinance.dev", use_defaults)
    password = ask("Password", "password123", use_defaults)
    display_name = ask("Display name", "Dev User", use_defaults)
    base_currency = ask("Base currency", "USD", use_defaults).upper()
    display_currency = ask("Display currency", "BRL", use_defaults).upper()
    secondary_default = "EUR" if base_currency != "EUR" else "USD"
    secondary_currency = ask(
        "Secondary currency (for a multi-currency account)", secondary_default, use_defaults
    ).upper()
    if secondary_currency == base_currency:
        secondary_currency = secondary_default
    start_month = ask_month("Start month (YYYY-MM)", default_start, use_defaults)
    end_month = ask_month("End month (YYYY-MM)", default_end, use_defaults)
    while end_month < start_month:
        print("  end month can't be before the start month, try again")
        end_month = ask_month("End month (YYYY-MM)", default_end, use_defaults)
    tx_per_month = ask_int("Transactions per month", 40, use_defaults)
    institutions_count = ask_int("Institutions", 3, use_defaults)
    accounts_count = ask_int("Spending accounts", 4, use_defaults)
    rng_seed = ask_int("RNG seed", 42, use_defaults)
    wipe = ask_bool("Wipe existing user with this email first?", True, use_defaults)

    return Config(
        email=email,
        password=password,
        display_name=display_name,
        base_currency=base_currency,
        display_currency=display_currency,
        secondary_currency=secondary_currency,
        start_month=start_month,
        end_month=end_month,
        tx_per_month=tx_per_month,
        institutions_count=institutions_count,
        accounts_count=accounts_count,
        rng_seed=rng_seed,
        wipe=wipe,
    )


# --- Fixture data ----------------------------------------------------------------

INSTITUTIONS: tuple[tuple[str, str, str], ...] = (
    ("Nubank", "bank", "#8A05BE"),
    ("Itau", "bank", "#EC7000"),
    ("Wise", "globe", "#4BB6A8"),
    ("Interactive Brokers", "chart", "#D91C5C"),
    ("Local Credit Union", "archive", "#1C4E80"),
)

SPENDING_ACCOUNTS: tuple[tuple[str, str], ...] = (
    ("Checking", ACCOUNT_TYPE_CHECKING),
    ("Everyday Spending", ACCOUNT_TYPE_CHECKING),
    ("Cash Wallet", ACCOUNT_TYPE_CASH),
    ("Travel Card", ACCOUNT_TYPE_CHECKING),
    ("Side Hustle", ACCOUNT_TYPE_CHECKING),
)


@dataclass(frozen=True)
class CategorySpec:
    name: str
    icon: str


@dataclass(frozen=True)
class GroupSpec:
    name: str
    icon: str
    color: str
    kind: str
    categories: tuple[CategorySpec, ...]


INCOME_GROUPS: tuple[GroupSpec, ...] = (
    GroupSpec(
        "Salary", "wallet", "#16A34A", CATEGORY_KIND_INCOME, (CategorySpec("Salary", "wallet"),)
    ),
    GroupSpec(
        "Investments",
        "chart",
        "#0891B2",
        CATEGORY_KIND_INCOME,
        (CategorySpec("Investments", "chart"),),
    ),
    GroupSpec(
        "Other Income",
        "tag",
        "#65A30D",
        CATEGORY_KIND_INCOME,
        (CategorySpec("Other Income", "tag"),),
    ),
)
EXPENSE_GROUPS: tuple[GroupSpec, ...] = (
    GroupSpec(
        "Housing",
        "home",
        "#DC2626",
        CATEGORY_KIND_EXPENSE,
        (CategorySpec("Rent", "key"), CategorySpec("Utilities", "plug")),
    ),
    GroupSpec(
        "Groceries",
        "tag",
        "#EA580C",
        CATEGORY_KIND_EXPENSE,
        (CategorySpec("Groceries", "cart"),),
    ),
    GroupSpec(
        "Transport",
        "swap",
        "#2563EB",
        CATEGORY_KIND_EXPENSE,
        (CategorySpec("Fuel", "fuel"), CategorySpec("Public Transit", "bus")),
    ),
    GroupSpec(
        "Dining",
        "tag",
        "#D97706",
        CATEGORY_KIND_EXPENSE,
        (CategorySpec("Restaurants", "utensils"), CategorySpec("Coffee", "coffee")),
    ),
    GroupSpec(
        "Entertainment",
        "target",
        "#7C3AED",
        CATEGORY_KIND_EXPENSE,
        (CategorySpec("Entertainment", "target"),),
    ),
    GroupSpec(
        "Travel", "globe", "#0D9488", CATEGORY_KIND_EXPENSE, (CategorySpec("Travel", "globe"),)
    ),
    GroupSpec(
        "Health",
        "alertTriangle",
        "#DB2777",
        CATEGORY_KIND_EXPENSE,
        (CategorySpec("Health", "heart"),),
    ),
    GroupSpec(
        "Subscriptions",
        "repeat",
        "#4B5563",
        CATEGORY_KIND_EXPENSE,
        (CategorySpec("Subscriptions", "repeat"),),
    ),
)


@dataclass(frozen=True)
class MerchantSpec:
    names: tuple[str, ...]
    low: Decimal
    high: Decimal
    weight: int
    weekend_skew: bool = False


# Keyed by leaf category name - most leaves in EXPENSE_GROUPS have an entry here.
# "Rent" and "Subscriptions" are deliberately absent: they're posted by a
# RecurringRule instead (see recurring_monthly_by_group below, which
# folds their monthly-equivalent spend into the budget for those groups).
MERCHANTS: dict[str, MerchantSpec] = {
    "Utilities": MerchantSpec(
        ("Power Co", "Water Utility", "Home Internet"), Decimal(40), Decimal(180), 8
    ),
    "Groceries": MerchantSpec(("Market", "Supermarket"), Decimal(20), Decimal(140), 20),
    "Fuel": MerchantSpec(("Gas Station",), Decimal(30), Decimal(90), 10),
    "Public Transit": MerchantSpec(("Transit Authority",), Decimal(5), Decimal(40), 8),
    "Restaurants": MerchantSpec(
        ("Restaurant", "Bistro"), Decimal(15), Decimal(90), 12, weekend_skew=True
    ),
    "Coffee": MerchantSpec(("Cafe",), Decimal(4), Decimal(15), 14, weekend_skew=True),
    "Entertainment": MerchantSpec(
        ("Cinema", "Streaming Rental", "Concert"), Decimal(10), Decimal(120), 8, weekend_skew=True
    ),
    "Travel": MerchantSpec(("Airline", "Hotel"), Decimal(150), Decimal(900), 2),
    "Health": MerchantSpec(("Pharmacy", "Clinic"), Decimal(15), Decimal(200), 5),
}
_MERCHANT_NAMES = list(MERCHANTS)
_MERCHANT_WEIGHTS = [MERCHANTS[name].weight for name in _MERCHANT_NAMES]


def pick_merchant_name(rng: random.Random) -> str:
    return rng.choices(_MERCHANT_NAMES, weights=_MERCHANT_WEIGHTS, k=1)[0]


# --- Small helpers -----------------------------------------------------------------


def month_str(day: date) -> str:
    return f"{day.year:04d}-{day.month:02d}"


def month_range(start_month: str, end_month: str) -> list[str]:
    start = date(int(start_month[:4]), int(start_month[5:7]), 1)
    end = date(int(end_month[:4]), int(end_month[5:7]), 1)
    months = []
    current = start
    while current <= end:
        months.append(month_str(current))
        current = add_months_clamped(current, 1)
    return months


def random_amount(rng: random.Random, low: Decimal, high: Decimal, digits: int = 2) -> Decimal:
    """A Decimal drawn uniformly from [low, high], quantized to `digits`
    decimal places - integer arithmetic throughout, no floats (money is
    never a float in this codebase, including in generated test data)."""
    quantum = Decimal(1).scaleb(-digits)
    low_units = int(low / quantum)
    high_units = int(high / quantum)
    return Decimal(rng.randint(low_units, high_units)) * quantum


# --- Seeding -------------------------------------------------------------------


async def wipe_user(db: AsyncSession, normalized_email: str) -> None:
    result = await db.execute(select(User).where(User.normalized_email == normalized_email))
    existing = result.scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
        await db.commit()


async def seed(db: AsyncSession, cfg: Config, rng: random.Random) -> tuple[UUID, int]:
    today = date.today()
    tx_count = 0

    user = User(
        email=cfg.email,
        normalized_email=normalize_email(cfg.email),
        password_hash=hash_password(cfg.password),
        display_name=cfg.display_name,
        role=ROLE_ADMIN,
        base_currency=cfg.base_currency,
        display_currency=cfg.display_currency,
    )
    db.add(user)
    await db.flush()  # assigns user.id (server-independent, but ORM-applied at flush)

    n_institutions = max(1, min(cfg.institutions_count, len(INSTITUTIONS)))
    institutions: list[Institution] = []
    for name, icon, color in INSTITUTIONS[:n_institutions]:
        institutions.append(
            await create_institution(
                db, user.id, InstitutionCreate(name=name, icon=icon, color=color)
            )
        )

    n_accounts = max(1, min(cfg.accounts_count, len(SPENDING_ACCOUNTS)))
    accounts: list[Account] = []
    for i in range(n_accounts):
        name, acc_type = SPENDING_ACCOUNTS[i]
        institution = institutions[i % len(institutions)]
        accounts.append(
            await create_account(
                db,
                user.id,
                AccountCreate(
                    name=name,
                    type=acc_type,
                    currency=cfg.base_currency,
                    opening_balance=random_amount(rng, Decimal(200), Decimal(3000)),
                    institution_id=institution.id,
                ),
            )
        )
    primary_checking = accounts[0]  # SPENDING_ACCOUNTS[0] is always checking-type

    savings_account = await create_account(
        db,
        user.id,
        AccountCreate(
            name="Savings",
            type=ACCOUNT_TYPE_SAVINGS,
            currency=cfg.base_currency,
            opening_balance=random_amount(rng, Decimal(1000), Decimal(8000)),
            institution_id=institutions[0].id,
        ),
    )
    credit_card_account = await create_account(
        db,
        user.id,
        AccountCreate(
            name="Credit Card",
            type=ACCOUNT_TYPE_CREDIT_CARD,
            currency=cfg.base_currency,
            opening_balance=Decimal(0),
            credit_limit=Decimal(5000),
            closing_day=5,
            due_day=20,
            institution_id=institutions[0].id,
        ),
    )
    investment_wallet, investment_account = await investments_service.create_wallet(
        db,
        user.id,
        InvestmentWalletCreate(
            name="Investments",
            currency=cfg.secondary_currency,
            cash_account_id=primary_checking.id,
            institution_id=institutions[-1].id,
        ),
    )

    groups_by_name: dict[str, CategoryGroup] = {}
    categories_by_name: dict[str, Category] = {}
    for group_spec in (*INCOME_GROUPS, *EXPENSE_GROUPS):
        group = await category_groups_service.create_group(
            db,
            user.id,
            CategoryGroupCreate(
                name=group_spec.name,
                kind=group_spec.kind,
                color=group_spec.color,
                icon=group_spec.icon,
            ),
        )
        groups_by_name[group_spec.name] = group
        for category_spec in group_spec.categories:
            category = await create_category(
                db,
                user.id,
                CategoryCreate(
                    name=category_spec.name,
                    kind=group_spec.kind,
                    group_id=group.id,
                    color=group_spec.color,
                    icon=category_spec.icon,
                ),
            )
            categories_by_name[category_spec.name] = category

    goal_target = random_amount(rng, Decimal(2000), Decimal(10000))
    _goal, goal_account = await create_goal_with_account(
        db,
        user.id,
        GoalWithAccountCreate(
            name="Emergency Fund",
            target_amount=goal_target,
            currency=cfg.base_currency,
            target_date=add_months_clamped(today, 12),
            frequency=RECURRING_FREQUENCY_MONTHLY,
            interval=1,
        ),
    )

    # Recurring rules: create each starting at the beginning of the
    # requested range, then immediately post every occurrence up through
    # today (or the end of the range, whichever is earlier) - the same
    # thing Celery beat would have done had it been running all along.
    # That also advances last_posted_date, so a real Celery run afterward
    # won't replay this history.
    range_start = date(int(cfg.start_month[:4]), int(cfg.start_month[5:7]), 1)
    range_end_month = date(int(cfg.end_month[:4]), int(cfg.end_month[5:7]), 1)
    range_end = date(
        range_end_month.year,
        range_end_month.month,
        calendar.monthrange(range_end_month.year, range_end_month.month)[1],
    )
    catch_up_today = min(today, range_end)

    # Investment domain: two manual-priced assets and a small buy/sell/
    # dividend/fee history in the wallet created above. The wallet's cash
    # account is the primary checking account, so buys and sells also
    # exercise cash settlement (including the cross-currency conversion
    # path, since the wallet's currency is cfg.secondary_currency while
    # checking is cfg.base_currency) - see app/services/investments.py.
    # quote_provider is manual for both assets so seeding never makes a
    # live network call.
    def investment_date(months_after_start: int, day: int) -> date:
        base = add_months_clamped(range_start, months_after_start)
        day = min(day, calendar.monthrange(base.year, base.month)[1])
        return min(date(base.year, base.month, day), catch_up_today)

    stock_asset = await investments_service.create_asset(
        db,
        user.id,
        InvestmentAssetCreate(
            symbol="ACME",
            name="Acme Industries",
            asset_class=ASSET_CLASS_STOCK,
            currency=cfg.secondary_currency,
            quote_provider=QUOTE_PROVIDER_MANUAL,
            manual_price=Decimal("45.00"),
        ),
    )
    etf_asset = await investments_service.create_asset(
        db,
        user.id,
        InvestmentAssetCreate(
            symbol="GLOBE",
            name="Global Equity ETF",
            asset_class=ASSET_CLASS_ETF,
            currency=cfg.secondary_currency,
            quote_provider=QUOTE_PROVIDER_MANUAL,
            manual_price=Decimal("118.00"),
        ),
    )
    await investments_service.create_investment_transaction(
        db,
        user.id,
        InvestmentTransactionCreate(
            wallet_id=investment_wallet.id,
            asset_id=stock_asset.id,
            type=INVESTMENT_TRANSACTION_TYPE_BUY,
            date=investment_date(0, 5),
            quantity=Decimal("8"),
            price=Decimal("40.00"),
            amount=Decimal("320.00"),
            fee=Decimal("2.50"),
            currency=cfg.secondary_currency,
        ),
    )
    tx_count += 1  # settled as a cash transfer against primary_checking
    await investments_service.create_investment_transaction(
        db,
        user.id,
        InvestmentTransactionCreate(
            wallet_id=investment_wallet.id,
            asset_id=etf_asset.id,
            type=INVESTMENT_TRANSACTION_TYPE_BUY,
            date=investment_date(2, 12),
            quantity=Decimal("4"),
            price=Decimal("115.00"),
            amount=Decimal("460.00"),
            fee=Decimal("3.00"),
            currency=cfg.secondary_currency,
        ),
    )
    tx_count += 1
    await investments_service.create_investment_transaction(
        db,
        user.id,
        InvestmentTransactionCreate(
            wallet_id=investment_wallet.id,
            asset_id=stock_asset.id,
            type=INVESTMENT_TRANSACTION_TYPE_DIVIDEND,
            date=investment_date(3, 20),
            amount=Decimal("12.50"),
            currency=cfg.secondary_currency,
        ),
    )
    await investments_service.create_investment_transaction(
        db,
        user.id,
        InvestmentTransactionCreate(
            wallet_id=investment_wallet.id,
            asset_id=stock_asset.id,
            type=INVESTMENT_TRANSACTION_TYPE_SELL,
            date=investment_date(4, 10),
            quantity=Decimal("3"),
            price=Decimal("48.00"),
            amount=Decimal("144.00"),
            fee=Decimal("1.50"),
            currency=cfg.secondary_currency,
        ),
    )
    tx_count += 1
    await investments_service.create_investment_transaction(
        db,
        user.id,
        InvestmentTransactionCreate(
            wallet_id=investment_wallet.id,
            asset_id=None,
            type=INVESTMENT_TRANSACTION_TYPE_FEE,
            date=investment_date(5, 1),
            amount=Decimal("5.00"),
            currency=cfg.secondary_currency,
        ),
    )

    salary_amount = random_amount(rng, Decimal(4000), Decimal(6000))
    rent_amount = random_amount(rng, Decimal(900), Decimal(1800))
    subscription_amount = random_amount(rng, Decimal(9), Decimal(25))
    annual_fee_amount = random_amount(rng, Decimal(60), Decimal(150))
    recurring_specs = (
        (
            RECURRING_FREQUENCY_MONTHLY,
            date(range_start.year, range_start.month, 5),
            TRANSACTION_TYPE_INCOME,
            salary_amount,
            primary_checking.id,
            categories_by_name["Salary"].id,
            "Salary",
        ),
        (
            RECURRING_FREQUENCY_MONTHLY,
            date(range_start.year, range_start.month, 1),
            TRANSACTION_TYPE_EXPENSE,
            rent_amount,
            primary_checking.id,
            categories_by_name["Rent"].id,
            "Rent",
        ),
        (
            RECURRING_FREQUENCY_MONTHLY,
            date(range_start.year, range_start.month, 10),
            TRANSACTION_TYPE_EXPENSE,
            subscription_amount,
            credit_card_account.id,
            categories_by_name["Subscriptions"].id,
            "Streaming Subscription",
        ),
        (
            RECURRING_FREQUENCY_YEARLY,
            date(range_start.year, range_start.month, 1),
            TRANSACTION_TYPE_EXPENSE,
            annual_fee_amount,
            credit_card_account.id,
            categories_by_name["Subscriptions"].id,
            "Annual Membership Fee",
        ),
    )
    for frequency, start, type_, amount, account_id, category_id, description in recurring_specs:
        rule = await create_recurring_rule(
            db,
            user.id,
            RecurringRuleCreate(
                frequency=frequency,
                interval=1,
                start_date=start,
                template=RecurringTemplateInput(
                    type=type_,
                    amount=amount,
                    currency=cfg.base_currency,
                    account_id=account_id,
                    category_id=category_id,
                    description=description,
                ),
            ),
        )
        posted = await post_due_occurrences(db, rule, today=catch_up_today)
        tx_count += len(posted)

    # A single fixed manual rate for the whole run - realistic enough for
    # dev data without pretending to track real historical rate movement.
    # ponytail: constant rate across the range; add per-quarter jitter if
    # a fluctuating rate history ever matters for a test.
    secondary_rate = random_amount(rng, Decimal("0.75"), Decimal("1.25"), digits=4)

    # Rent and the two Subscriptions recurring transactions post real
    # monthly spend that MERCHANTS-derived budgets below can't see (neither
    # has a MERCHANTS entry - see the comment above MERCHANTS) - fold their
    # monthly-equivalent amount into the matching expense group's budget so
    # it isn't guaranteed to run over every month.
    recurring_monthly_by_group: dict[str, Decimal] = {
        "Housing": rent_amount,
        "Subscriptions": subscription_amount + annual_fee_amount / Decimal(12),
    }

    total_weight = sum(spec.weight for spec in MERCHANTS.values())
    budget_amount_by_group: dict[str, Decimal] = {}
    allocation_pct_by_group: dict[str, Decimal] = {}
    for spec in EXPENSE_GROUPS:
        leaves = [category.name for category in spec.categories if category.name in MERCHANTS]
        weight = sum(MERCHANTS[leaf].weight for leaf in leaves)
        if leaves:
            avg = sum((MERCHANTS[leaf].low + MERCHANTS[leaf].high) for leaf in leaves) / (
                Decimal(2 * len(leaves))
            )
            expected_tx = Decimal(cfg.tx_per_month) * Decimal(weight) / Decimal(total_weight)
            merchant_component = expected_tx * avg
        else:
            merchant_component = Decimal(0)
        recurring_component = recurring_monthly_by_group.get(spec.name, Decimal(0))
        budget_amount_by_group[spec.name] = (
            (merchant_component + recurring_component) * Decimal("1.15")
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        allocation_pct_by_group[spec.name] = (
            (Decimal(weight) / Decimal(total_weight) * Decimal(90)).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            if weight > 0
            else Decimal(0)
        )
    for spec in EXPENSE_GROUPS:
        pct = allocation_pct_by_group[spec.name]
        if pct > 0:
            await upsert_allocation(
                db,
                user.id,
                BudgetAllocationUpsert(group_id=groups_by_name[spec.name].id, percentage=pct),
            )

    for month in month_range(cfg.start_month, cfg.end_month):
        year, mon = int(month[:4]), int(month[5:7])
        days_in_month = calendar.monthrange(year, mon)[1]
        month_end = date(year, mon, days_in_month)
        last_day = min(month_end, today)
        if last_day < date(year, mon, 1):
            continue  # whole month is still in the future
        all_days = [date(year, mon, d) for d in range(1, last_day.day + 1)]
        weekend_days = [d for d in all_days if d.weekday() >= 5] or all_days

        for _ in range(cfg.tx_per_month):
            leaf_name = pick_merchant_name(rng)
            merchant_spec = MERCHANTS[leaf_name]
            merchant = rng.choice(merchant_spec.names)
            amount = random_amount(rng, merchant_spec.low, merchant_spec.high)
            use_weekend = merchant_spec.weekend_skew and rng.random() < 0.7
            tx_date = rng.choice(weekend_days if use_weekend else all_days)

            roll = rng.random()
            conversion: ConversionInput | None = None
            if roll < 0.08:
                account = investment_account
                fee = (
                    random_amount(rng, Decimal(0), amount * Decimal("0.02"))
                    if rng.random() < 0.3
                    else None
                )
                conversion = ConversionInput(
                    currency=cfg.secondary_currency,
                    rate=secondary_rate,
                    fee=fee,
                    source=CONVERSION_SOURCE_MANUAL,
                )
            elif roll < 0.32:
                account = credit_card_account
            else:
                account = primary_checking

            await create_transaction(
                db,
                user.id,
                TransactionCreate(
                    type=TRANSACTION_TYPE_EXPENSE,
                    date=tx_date,
                    amount=amount,
                    currency=cfg.base_currency,
                    account_id=account.id,
                    category_id=categories_by_name[leaf_name].id,
                    description=merchant,
                    conversion=conversion,
                ),
            )
            tx_count += 1

        await create_transaction(
            db,
            user.id,
            TransactionCreate(
                type=TRANSACTION_TYPE_TRANSFER,
                date=rng.choice(all_days),
                amount=random_amount(rng, Decimal(100), Decimal(500)),
                currency=cfg.base_currency,
                account_id=primary_checking.id,
                to_account_id=savings_account.id,
                description="Monthly Savings Transfer",
            ),
        )
        tx_count += 1

        await create_transaction(
            db,
            user.id,
            TransactionCreate(
                type=TRANSACTION_TYPE_TRANSFER,
                date=rng.choice(all_days),
                amount=random_amount(rng, Decimal(50), Decimal(300)),
                currency=cfg.base_currency,
                account_id=primary_checking.id,
                to_account_id=goal_account.id,
                description="Goal Contribution",
            ),
        )
        tx_count += 1

        if mon in (3, 6, 9, 12) and last_day == month_end:
            await create_transaction(
                db,
                user.id,
                TransactionCreate(
                    type=TRANSACTION_TYPE_INTEREST,
                    date=month_end,
                    amount=random_amount(rng, Decimal(5), Decimal(40)),
                    currency=cfg.base_currency,
                    account_id=savings_account.id,
                    description="Interest Payment",
                ),
            )
            tx_count += 1

        if mon in (1, 4, 7, 10):
            await upsert_manual_rate(
                db,
                user.id,
                cfg.base_currency,
                cfg.secondary_currency,
                date(year, mon, 1),
                secondary_rate,
            )

        for spec in EXPENSE_GROUPS:
            await upsert_budget(
                db,
                user.id,
                BudgetUpsert(
                    group_id=groups_by_name[spec.name].id,
                    month=month,
                    amount=budget_amount_by_group[spec.name],
                    currency=cfg.base_currency,
                ),
            )
        await upsert_expected_income(
            db,
            user.id,
            ExpectedIncomeUpsert(month=month, amount=salary_amount, currency=cfg.base_currency),
        )

    return user.id, tx_count


async def verify(db: AsyncSession, user_id: UUID, expected_tx_count: int) -> None:
    """Sanity checks that run on every seed - not a separate test file.
    A failed assert here means the generator itself is broken, not that a
    developer's database is in a bad state."""
    actual = await db.scalar(
        select(func.count()).select_from(Transaction).where(Transaction.user_id == user_id)
    )
    assert actual == expected_tx_count, f"expected {expected_tx_count} transactions, found {actual}"

    balances = await account_balances(db, user_id)
    assert balances, "no account balances computed"

    today = date.today()
    max_date = await db.scalar(
        select(func.max(Transaction.date)).where(Transaction.user_id == user_id)
    )
    assert max_date is None or max_date <= today, f"future-dated transaction: {max_date}"

    result = await db.execute(
        select(Transaction).where(
            Transaction.user_id == user_id, Transaction.conversion_amount.is_not(None)
        )
    )
    for tx in result.scalars():
        assert tx.conversion_currency is not None
        assert tx.conversion_rate is not None
        currency = await get_active_currency(db, tx.conversion_currency)
        quantum = Decimal(1).scaleb(-currency.decimal_digits)
        fee = tx.conversion_fee or Decimal(0)
        expected = ((tx.amount - fee) * tx.conversion_rate).quantize(
            quantum, rounding=ROUND_HALF_UP
        )
        assert tx.conversion_amount is not None
        assert abs(tx.conversion_amount - expected) <= quantum, (
            f"conversion mismatch on transaction {tx.id}"
        )

    total_pct = await db.scalar(
        select(func.sum(BudgetAllocation.percentage)).where(BudgetAllocation.user_id == user_id)
    )
    assert total_pct is None or total_pct <= 100, f"budget allocations exceed 100%: {total_pct}"


async def run(cfg: Config) -> None:
    async with session_scope() as db:
        normalized = normalize_email(cfg.email)
        if cfg.wipe:
            await wipe_user(db, normalized)
        else:
            existing = await db.scalar(select(User).where(User.normalized_email == normalized))
            if existing is not None:
                print(f"User {cfg.email} already exists - rerun with wipe=yes to reset it.")
                return

        rng = random.Random(cfg.rng_seed)
        user_id, tx_count = await seed(db, cfg, rng)
        await verify(db, user_id, tx_count)

    print(f"Seeded {cfg.email} / {cfg.password} ({tx_count} transactions, seed={cfg.rng_seed})")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed a local dev user with realistic demo data.")
    parser.add_argument(
        "-y", "--defaults", action="store_true", help="Accept every default without prompting."
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    cfg = prompt_config(use_defaults=args.defaults)
    asyncio.run(run(cfg))


if __name__ == "__main__":
    main()
