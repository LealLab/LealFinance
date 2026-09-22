"""coingecko quotes

Revision ID: b4c6d8e0f2a4
Revises: f4a5b6c7d8e9
Create Date: 2026-09-22 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b4c6d8e0f2a4"
down_revision: str | Sequence[str] | None = "f4a5b6c7d8e9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the keyless CoinGecko quote provider and key asset_quotes by
    currency so the same symbol can be cached independently per wallet
    currency."""
    op.drop_constraint("ck_investment_assets_quote_provider", "investment_assets", type_="check")
    op.create_check_constraint(
        "ck_investment_assets_quote_provider",
        "investment_assets",
        "quote_provider IN ('twelve_data', 'brapi', 'coingecko', 'manual')",
    )
    op.drop_constraint(
        "ck_market_data_credentials_provider", "market_data_credentials", type_="check"
    )
    op.create_check_constraint(
        "ck_market_data_credentials_provider",
        "market_data_credentials",
        "provider IN ('twelve_data', 'brapi', 'coingecko')",
    )
    op.drop_constraint("uq_asset_quotes_symbol_as_of", "asset_quotes", type_="unique")
    op.create_unique_constraint(
        "uq_asset_quotes_symbol_currency_as_of", "asset_quotes", ["symbol", "currency", "as_of"]
    )


def downgrade() -> None:
    """Drop the CoinGecko provider and restore the symbol+as_of cache key."""
    op.execute(sa.text("DELETE FROM asset_quotes"))
    op.drop_constraint("uq_asset_quotes_symbol_currency_as_of", "asset_quotes", type_="unique")
    op.create_unique_constraint("uq_asset_quotes_symbol_as_of", "asset_quotes", ["symbol", "as_of"])

    op.execute(
        sa.text(
            "UPDATE investment_assets SET quote_provider = 'manual' "
            "WHERE quote_provider = 'coingecko'"
        )
    )
    op.drop_constraint("ck_investment_assets_quote_provider", "investment_assets", type_="check")
    op.create_check_constraint(
        "ck_investment_assets_quote_provider",
        "investment_assets",
        "quote_provider IN ('twelve_data', 'brapi', 'manual')",
    )

    op.execute(sa.text("DELETE FROM market_data_credentials WHERE provider = 'coingecko'"))
    op.drop_constraint(
        "ck_market_data_credentials_provider", "market_data_credentials", type_="check"
    )
    op.create_check_constraint(
        "ck_market_data_credentials_provider",
        "market_data_credentials",
        "provider IN ('twelve_data', 'brapi')",
    )
