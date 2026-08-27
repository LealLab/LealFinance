"""Categories live inside a category group. `kind` is kept on each category
as a denormalized copy of its group's kind because existing readers filter on
it directly. `position` is 0-based, scoped to categories sharing the same
`(user_id, kind, group_id)` group.

The service layer enforces that a category and its group belong to the same
user and have the same kind; a CHECK constraint cannot read another row.
"""

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel

CATEGORY_KIND_INCOME = "income"
CATEGORY_KIND_EXPENSE = "expense"
CATEGORY_KINDS = (CATEGORY_KIND_INCOME, CATEGORY_KIND_EXPENSE)


def _in_check(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


class Category(UserOwnedModel):
    __tablename__ = "categories"
    __error_prefix__ = "category"
    __table_args__ = (
        CheckConstraint(_in_check("kind", CATEGORY_KINDS), name="ck_categories_kind"),
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("category_groups.id", ondelete="RESTRICT", name="fk_categories_group_id"),
        nullable=False,
        index=True,
    )
    color: Mapped[str] = mapped_column(String(9), nullable=False)
    icon: Mapped[str] = mapped_column(String(50), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
