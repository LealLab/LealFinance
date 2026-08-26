"""Re-exports every ORM model so importing `app.models` fully populates
`Base.metadata` for Alembic autogenerate and for the test schema fixtures.

Every new model module must be imported here, or Alembic autogenerate and
`Base.metadata.create_all` in tests will silently miss it.
"""

from app.models.account import Account
from app.models.agent_credential import AgentCredential
from app.models.budget import Budget, BudgetAllocation, ExpectedIncome
from app.models.category import Category
from app.models.currency import Currency, ExchangeRate
from app.models.goal import Goal
from app.models.institution import Institution
from app.models.investment import (
    AssetQuote,
    InvestmentAsset,
    InvestmentTransaction,
    InvestmentWallet,
    MarketDataCredential,
)
from app.models.manual_rate import ManualRate
from app.models.recurring import RecurringRule
from app.models.transaction import Transaction
from app.models.user import Invitation, Session, User

__all__ = [
    "Account",
    "AgentCredential",
    "AssetQuote",
    "Budget",
    "BudgetAllocation",
    "Category",
    "Currency",
    "ExchangeRate",
    "ExpectedIncome",
    "Goal",
    "Institution",
    "InvestmentAsset",
    "InvestmentTransaction",
    "InvestmentWallet",
    "MarketDataCredential",
    "Invitation",
    "ManualRate",
    "RecurringRule",
    "Session",
    "Transaction",
    "User",
]
