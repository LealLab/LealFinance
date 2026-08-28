"""User-defined rules that assign transaction categories."""

import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel

MATCH_OPS = ("and", "or")


def _in_check(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} IN ({quoted})"


class CategorizationRule(UserOwnedModel):
    __tablename__ = "categorization_rules"
    __error_prefix__ = "categorization_rule"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_categorization_rules_user_id_name"),
        CheckConstraint(_in_check("match_op", MATCH_OPS), name="ck_categorization_rules_match_op"),
    )

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    match_op: Mapped[str] = mapped_column(String(3), nullable=False)
    conditions: Mapped[list[dict[str, object]]] = mapped_column(JSONB, nullable=False)
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="CASCADE", name="fk_categorization_rules_category_id"),
        nullable=False,
        index=True,
    )
