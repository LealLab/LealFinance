"""Institutions - a display/organizational grouping above accounts (a
bank, brokerage, wallet provider, ...). Purely organizational: nothing on
Transaction references an institution directly, only Account.institution_id
does (see app/models/account.py), and an account legitimately has none
(e.g. a cash account).
"""

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel


class Institution(UserOwnedModel):
    __tablename__ = "institutions"
    __error_prefix__ = "institution"

    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # Icon-set key from the frontend's IconName union - validated in the
    # Pydantic schema (app/schemas/common.py), not here: adding a new icon
    # must not require a migration.
    icon: Mapped[str] = mapped_column(String(50), nullable=False)
    color: Mapped[str | None] = mapped_column(String(9))  # e.g. "#RRGGBBAA"
    archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
