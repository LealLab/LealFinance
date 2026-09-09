"""Latest run state for each scheduled Celery routine, so an operator can
see whether the recurring/loan/card posters and rate jobs actually ran,
succeeded, or partially failed. One row per job name, upserted per run.
Deliberately not a history table - the last outcome is enough to answer
'is automation healthy?'."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

JOB_STATUS_RUNNING = "running"
JOB_STATUS_SUCCESS = "success"
JOB_STATUS_PARTIAL = "partial"
JOB_STATUS_FAILED = "failed"


class JobRun(Base, UUIDPrimaryKeyMixin, TimestampMixin):
    __tablename__ = "job_runs"

    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    processed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    failed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Exception class name only - never a message or row data (operational
    # diagnostics must not carry financial content).
    error_type: Mapped[str | None] = mapped_column(String(128))
