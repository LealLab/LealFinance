"""credit-card invoice payment fields

Revision ID: a8b9c0d1e2f3
Revises: f7a8b9c0d1e2
Create Date: 2026-09-01 00:00:00.000000

Adds the account-level "which account pays this card, and does it pay
itself" fields plus the transaction provenance column that ties a payment
to the billing cycle it settles. No invoice table: an invoice is derived
from the ledger (see app/services/card_invoices.py), the same way a
balance and a loan's paid-installment count are.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8b9c0d1e2f3"
down_revision: str | Sequence[str] | None = "f7a8b9c0d1e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "accounts",
        sa.Column("payment_account_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    # server_default false backfills existing rows; dropped immediately after
    # so the app-level default (models/account.py) is the only source of truth.
    op.add_column(
        "accounts",
        sa.Column("auto_pay", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("accounts", "auto_pay", server_default=None)

    op.create_foreign_key(
        "fk_accounts_payment_account_id",
        "accounts",
        "accounts",
        ["payment_account_id"],
        ["id"],
        ondelete="RESTRICT",
    )

    op.drop_constraint("ck_accounts_credit_card_fields_only", "accounts", type_="check")
    op.create_check_constraint(
        "ck_accounts_credit_card_fields_only",
        "accounts",
        "type = 'credit_card' OR ("
        "credit_limit IS NULL AND closing_day IS NULL AND due_day IS NULL "
        "AND payment_account_id IS NULL AND NOT auto_pay)",
    )
    op.create_check_constraint(
        "ck_accounts_auto_pay_requires_account",
        "accounts",
        "NOT auto_pay OR payment_account_id IS NOT NULL",
    )
    op.create_check_constraint(
        "ck_accounts_payment_account_distinct",
        "accounts",
        "payment_account_id IS NULL OR payment_account_id <> id",
    )

    op.add_column(
        "transactions",
        sa.Column("card_invoice_close_date", sa.Date(), nullable=True),
    )
    op.create_index(
        "ix_transactions_card_invoice_close_date",
        "transactions",
        ["card_invoice_close_date"],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_transactions_card_invoice_close_date", table_name="transactions")
    op.drop_column("transactions", "card_invoice_close_date")

    op.drop_constraint("ck_accounts_payment_account_distinct", "accounts", type_="check")
    op.drop_constraint("ck_accounts_auto_pay_requires_account", "accounts", type_="check")
    op.drop_constraint("ck_accounts_credit_card_fields_only", "accounts", type_="check")
    op.create_check_constraint(
        "ck_accounts_credit_card_fields_only",
        "accounts",
        "type = 'credit_card' OR "
        "(credit_limit IS NULL AND closing_day IS NULL AND due_day IS NULL)",
    )

    op.drop_constraint("fk_accounts_payment_account_id", "accounts", type_="foreignkey")
    op.drop_column("accounts", "auto_pay")
    op.drop_column("accounts", "payment_account_id")
