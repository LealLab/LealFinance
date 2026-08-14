"""Categories - one level of nesting only (a category with a `parent_id`
points at a top-level category, never at another child). `position` is
0-based, scoped to categories sharing the same `(user_id, kind, parent_id)`
sibling group.

The one-level-nesting rule, and "parent must belong to the same user and
share the same kind" invariant, can't be expressed as a CHECK constraint (a
CHECK can't read another row) - see app/services/categories.py for both.
`ondelete="RESTRICT"` on the self-FK is still a DB backstop for "can't
delete a category that has children," which the service also checks first.
"""

import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String
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
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="RESTRICT", name="fk_categories_parent_id"),
    )
    color: Mapped[str] = mapped_column(String(9), nullable=False)
    icon: Mapped[str] = mapped_column(String(50), nullable=False)
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
