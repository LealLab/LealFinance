"""Declarative base and reusable mixins for all ORM models."""

import uuid
from datetime import datetime
from typing import ClassVar

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column


class Base(DeclarativeBase):
    pass


class UUIDPrimaryKeyMixin:
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class UserOwnedModel(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    """Base for every user-owned table (institutions, accounts, categories,
    transactions, ...). `user_id` is declared here, not repeated per model,
    so the ownership-scoping helpers in app/services/ownership.py can be
    generic over it and so no domain model can accidentally ship without
    an owner column.

    `__error_prefix__` names the entity for 404 error codes - e.g.
    "institution" -> "institution.not_found" - set by every concrete
    subclass and consumed by app/services/ownership.py.
    """

    __abstract__ = True
    __error_prefix__: ClassVar[str]

    @declared_attr
    def user_id(cls) -> Mapped[uuid.UUID]:
        return mapped_column(
            UUID(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE", name=f"fk_{cls.__tablename__}_user_id"),
            nullable=False,
            index=True,
        )
