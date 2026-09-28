"""Categories take their group's color.

Revision ID: d6e8f0a2b4c6
Revises: c5d7e9f1a3b5
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "d6e8f0a2b4c6"
down_revision: str | Sequence[str] | None = "c5d7e9f1a3b5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE categories SET color = category_groups.color "
            "FROM category_groups "
            "WHERE categories.group_id = category_groups.id "
            "AND categories.color <> category_groups.color"
        )
    )


def downgrade() -> None:
    # The per-category colors this overwrote are gone; nothing to restore.
    pass
