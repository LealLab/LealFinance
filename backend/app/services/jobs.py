"""Health and manual dispatch for scheduled Celery routines."""

from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.models.job_run import JOB_STATUS_RUNNING, JobRun
from app.workers.celery_app import JOB_INTERVALS, celery_app


@dataclass
class JobHealth:
    name: str
    state: str
    status: str | None
    started_at: datetime | None
    finished_at: datetime | None
    processed: int
    failed: int
    error_type: str | None
    interval_seconds: int


async def list_job_health(db: AsyncSession, *, now: datetime) -> list[JobHealth]:
    rows = await db.scalars(select(JobRun).where(JobRun.name.in_(JOB_INTERVALS)))
    by_name = {row.name: row for row in rows}
    health: list[JobHealth] = []

    for name, interval in JOB_INTERVALS.items():
        row = by_name.get(name)
        if row is None:
            state = "never_run"
            status = None
            started_at = None
            finished_at = None
            processed = 0
            failed = 0
            error_type = None
        else:
            grace = max(interval * 0.5, timedelta(minutes=30))
            if row.status == JOB_STATUS_RUNNING and now - row.started_at > 2 * interval:
                state = "stuck"
            elif now - (row.finished_at or row.started_at) > interval + grace:
                state = "stale"
            else:
                state = row.status
            status = row.status
            started_at = row.started_at
            finished_at = row.finished_at
            processed = row.processed
            failed = row.failed
            error_type = row.error_type

        health.append(
            JobHealth(
                name=name,
                state=state,
                status=status,
                started_at=started_at,
                finished_at=finished_at,
                processed=processed,
                failed=failed,
                error_type=error_type,
                interval_seconds=int(interval.total_seconds()),
            )
        )
    return health


async def trigger_job(name: str) -> None:
    if name not in JOB_INTERVALS:
        raise NotFoundError(code="job.not_found")
    celery_app.send_task(name)
