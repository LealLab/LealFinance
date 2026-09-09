"""One row per completed transaction-import batch, keyed by the client's
idempotency key, so a retried commit returns the original result instead
of importing the rows again."""

from sqlalchemy import Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import UserOwnedModel


class ImportIdempotency(UserOwnedModel):
    __tablename__ = "import_idempotency"
    __error_prefix__ = "import_idempotency"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_import_idempotency_user_key"),)

    key: Mapped[str] = mapped_column(String(64), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_count: Mapped[int] = mapped_column(Integer, nullable=False)
