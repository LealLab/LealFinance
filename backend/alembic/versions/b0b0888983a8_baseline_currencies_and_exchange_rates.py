"""baseline currencies and exchange rates

Revision ID: b0b0888983a8
Revises:
Create Date: 2026-08-12 18:28:00.269920

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b0b0888983a8"
down_revision: str | Sequence[str] | None = None
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


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "currencies",
        sa.Column("code", sa.String(length=3), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("symbol", sa.String(length=10), nullable=False),
        sa.Column("decimal_digits", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("code"),
    )

    op.create_table(
        "exchange_rates",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("base_code", sa.String(length=3), nullable=False),
        sa.Column("quote_code", sa.String(length=3), nullable=False),
        sa.Column("rate", sa.Numeric(precision=19, scale=10), nullable=False),
        sa.Column("as_of", sa.Date(), nullable=False),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["base_code"], ["currencies.code"]),
        sa.ForeignKeyConstraint(["quote_code"], ["currencies.code"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("base_code", "quote_code", "as_of", "source", name="uq_exchange_rate"),
    )

    # Seed data: BRL is the only currency LealFinance supports at launch.
    op.bulk_insert(
        currencies_table,
        [
            {
                "code": "BRL",
                "name": "Brazilian Real",
                "symbol": "R$",
                "decimal_digits": 2,
                "is_active": True,
            }
        ],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("exchange_rates")
    op.drop_table("currencies")
