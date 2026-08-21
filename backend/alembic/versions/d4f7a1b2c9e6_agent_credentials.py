"""agent credentials

Revision ID: d4f7a1b2c9e6
Revises: a1c9f4d7e2b3
Create Date: 2026-08-20 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4f7a1b2c9e6"
down_revision: str | Sequence[str] | None = "a1c9f4d7e2b3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "agent_credentials",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("auth_mode", sa.String(length=16), nullable=False),
        sa.Column("secret_ciphertext", sa.Text(), nullable=True),
        sa.Column("refresh_ciphertext", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("account_id", sa.String(length=128), nullable=True),
        sa.Column("account_label", sa.String(length=255), nullable=True),
        sa.Column("base_url", sa.String(length=255), nullable=True),
        sa.Column("model", sa.String(length=128), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_agent_credentials_user_id", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "provider", name="uq_agent_credentials_user_id_provider"),
        sa.CheckConstraint(
            "provider IN ('anthropic', 'openai', 'ollama')",
            name="ck_agent_credentials_provider",
        ),
        sa.CheckConstraint(
            "auth_mode IN ('api_key', 'oauth', 'none')",
            name="ck_agent_credentials_auth_mode",
        ),
    )
    op.create_index("ix_agent_credentials_user_id", "agent_credentials", ["user_id"])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_agent_credentials_user_id", table_name="agent_credentials")
    op.drop_table("agent_credentials")
