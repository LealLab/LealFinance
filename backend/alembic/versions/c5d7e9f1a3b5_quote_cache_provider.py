"""Isolate cached quotes by provider.

Revision ID: c5d7e9f1a3b5
Revises: b4c6d8e0f2a4
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c5d7e9f1a3b5"
down_revision: str | Sequence[str] | None = "b4c6d8e0f2a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("uq_asset_quotes_symbol_currency_as_of", "asset_quotes", type_="unique")
    op.create_unique_constraint(
        "uq_asset_quotes_symbol_currency_source_as_of",
        "asset_quotes",
        ["symbol", "currency", "source", "as_of"],
    )


def downgrade() -> None:
    # Cached prices can be fetched again; different providers may now collide.
    op.execute(sa.text("DELETE FROM asset_quotes"))
    op.drop_constraint(
        "uq_asset_quotes_symbol_currency_source_as_of", "asset_quotes", type_="unique"
    )
    op.create_unique_constraint(
        "uq_asset_quotes_symbol_currency_as_of", "asset_quotes", ["symbol", "currency", "as_of"]
    )
