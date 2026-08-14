"""seed usd eur gbp currencies

Revision ID: 47379d62fa35
Revises: 7888eda24993
Create Date: 2026-08-14 14:34:19.042637

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "47379d62fa35"
down_revision: str | Sequence[str] | None = "7888eda24993"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


currencies_table = sa.table(
    "currencies",
    sa.column("code", sa.String),
    sa.column("name", sa.String),
    sa.column("symbol", sa.String),
    sa.column("decimal_digits", sa.Integer),
    sa.column("is_active", sa.Boolean),
)

_NEW_CODES = ("USD", "EUR", "GBP")


def upgrade() -> None:
    """Upgrade schema."""
    op.bulk_insert(
        currencies_table,
        [
            {
                "code": "USD",
                "name": "US Dollar",
                "symbol": "$",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "EUR",
                "name": "Euro",
                "symbol": "€",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "GBP",
                "name": "Pound Sterling",
                "symbol": "£",
                "decimal_digits": 2,
                "is_active": True,
            },
        ],
    )


def downgrade() -> None:
    """Downgrade schema.

    Deletes only the three rows this revision inserted. This fails with a
    foreign-key violation if anything (an account, budget, transaction, or
    manual rate) already references one of them - which is correct: those
    references would otherwise dangle.
    """
    op.execute(currencies_table.delete().where(currencies_table.c.code.in_(_NEW_CODES)))
