"""Category groups are organizational buckets that contain categories.

Groups themselves are never referenced by a transaction; transactions keep
pointing at individual categories inside the group. `position` is 0-based,
scoped to groups sharing the same `(user_id, kind)`.
"""

from sqlalchemy import CheckConstraint, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel
from app.models.category import CATEGORY_KINDS, _in_check


class CategoryGroup(UserOwnedModel):
    __tablename__ = "category_groups"
    __error_prefix__ = "category_group"
    __table_args__ = (
        CheckConstraint(_in_check("kind", CATEGORY_KINDS), name="ck_category_groups_kind"),
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    color: Mapped[str] = mapped_column(String(9), nullable=False)
    icon: Mapped[str] = mapped_column(String(50), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
