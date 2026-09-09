"""Wraps a scheduled task so its outcome is persisted to job_runs. The
task's own work still manages its own engine/session; this opens a
separate short-lived session purely to record start and finish, so a
rolled-back work session never loses the run record."""

import asyncio
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.models.job_run import (
    JOB_STATUS_FAILED,
    JOB_STATUS_PARTIAL,
    JOB_STATUS_RUNNING,
    JOB_STATUS_SUCCESS,
    JobRun,
)
from app.services.posting_result import PostingResult


async def _record_start(name: str) -> None:
    engine = create_async_engine(get_settings().sqlalchemy_database_uri, poolclass=NullPool)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            stmt = insert(JobRun).values(
                name=name,
                started_at=datetime.now(UTC),
                status=JOB_STATUS_RUNNING,
                processed=0,
                failed=0,
            )
            await db.execute(
                stmt.on_conflict_do_update(
                    index_elements=[JobRun.name],
                    set_={
                        "started_at": stmt.excluded.started_at,
                        "finished_at": None,
                        "status": JOB_STATUS_RUNNING,
                        "processed": 0,
                        "failed": 0,
                        "error_type": None,
                    },
                )
            )
            await db.commit()
    finally:
        await engine.dispose()


async def _record_finish(
    name: str,
    *,
    status: str,
    processed: int,
    failed: int,
    error_type: str | None,
) -> None:
    engine = create_async_engine(get_settings().sqlalchemy_database_uri, poolclass=NullPool)
    try:
        async with AsyncSession(engine, expire_on_commit=False) as db:
            stmt = insert(JobRun).values(
                name=name,
                started_at=datetime.now(UTC),
                finished_at=datetime.now(UTC),
                status=status,
                processed=processed,
                failed=failed,
                error_type=error_type,
            )
            await db.execute(
                stmt.on_conflict_do_update(
                    index_elements=[JobRun.name],
                    set_={
                        "finished_at": func.now(),
                        "status": status,
                        "processed": processed,
                        "failed": failed,
                        "error_type": error_type,
                    },
                )
            )
            await db.commit()
    finally:
        await engine.dispose()


async def _run_job(name: str, work: Callable[[], Awaitable[PostingResult]]) -> str:
    await _record_start(name)
    try:
        result = await work()
    except Exception as exc:
        await _record_finish(
            name,
            status=JOB_STATUS_FAILED,
            processed=0,
            failed=0,
            error_type=type(exc).__name__,
        )
        raise
    status = JOB_STATUS_PARTIAL if result.failed else JOB_STATUS_SUCCESS
    await _record_finish(
        name,
        status=status,
        processed=result.processed,
        failed=result.failed,
        error_type=None,
    )
    return f"processed {result.processed}, failed {result.failed}"


def run_job(name: str, work: Callable[[], Awaitable[PostingResult]]) -> str:
    return asyncio.run(_run_job(name, work))
