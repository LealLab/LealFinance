"""seed currencies for supported locales

Revision ID: 6f3d1c2e4a7b
Revises: 09a785796657
Create Date: 2026-08-16 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6f3d1c2e4a7b"
down_revision: str | Sequence[str] | None = "09a785796657"
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

_NEW_CODES = (
    "PLN",
    "RUB",
    "UAH",
    "TRY",
    "AED",
    "ILS",
    "INR",
    "CNY",
    "TWD",
    "JPY",
    "KRW",
    "IDR",
    "VND",
    "THB",
    "SEK",
    "DKK",
    "NOK",
    "CZK",
    "RON",
)


def upgrade() -> None:
    """Upgrade schema."""
    op.bulk_insert(
        currencies_table,
        [
            {
                "code": "PLN",
                "name": "Polish Złoty",
                "symbol": "zł",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "RUB",
                "name": "Russian Ruble",
                "symbol": "₽",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "UAH",
                "name": "Ukrainian Hryvnia",
                "symbol": "₴",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "TRY",
                "name": "Turkish Lira",
                "symbol": "₺",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "AED",
                "name": "UAE Dirham",
                "symbol": "د.إ",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "ILS",
                "name": "Israeli New Shekel",
                "symbol": "₪",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "INR",
                "name": "Indian Rupee",
                "symbol": "₹",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "CNY",
                "name": "Chinese Yuan",
                "symbol": "¥",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "TWD",
                "name": "New Taiwan Dollar",
                "symbol": "NT$",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "JPY",
                "name": "Japanese Yen",
                "symbol": "¥",
                "decimal_digits": 0,
                "is_active": True,
            },
            {
                "code": "KRW",
                "name": "South Korean Won",
                "symbol": "₩",
                "decimal_digits": 0,
                "is_active": True,
            },
            {
                "code": "IDR",
                "name": "Indonesian Rupiah",
                "symbol": "Rp",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "VND",
                "name": "Vietnamese Đồng",
                "symbol": "₫",
                "decimal_digits": 0,
                "is_active": True,
            },
            {
                "code": "THB",
                "name": "Thai Baht",
                "symbol": "฿",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "SEK",
                "name": "Swedish Krona",
                "symbol": "kr",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "DKK",
                "name": "Danish Krone",
                "symbol": "kr",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "NOK",
                "name": "Norwegian Krone",
                "symbol": "kr",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "CZK",
                "name": "Czech Koruna",
                "symbol": "Kč",
                "decimal_digits": 2,
                "is_active": True,
            },
            {
                "code": "RON",
                "name": "Romanian Leu",
                "symbol": "lei",
                "decimal_digits": 2,
                "is_active": True,
            },
        ],
    )


def downgrade() -> None:
    """Delete only the currencies inserted by this revision."""
    op.execute(currencies_table.delete().where(currencies_table.c.code.in_(_NEW_CODES)))
