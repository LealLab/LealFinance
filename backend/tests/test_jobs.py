"""Persisted scheduled-job state and admin visibility."""

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job_run import JobRun
from app.services.posting_result import PostingResult
from app.workers.celery_app import JOB_INTERVALS, celery_app
from app.workers.runner import _run_job
from tests.factories import login_as, make_user


async def _admin_login(client: AsyncClient, db_session: AsyncSession) -> None:
    admin, password = await make_user(db_session, email="jobs-admin@example.com", role="admin")
    await login_as(client, email=admin.email, password=password)


async def test_partial_run_is_recorded(db_session: AsyncSession) -> None:
    name = "test.jobs.partial"

    async def work() -> PostingResult:
        return PostingResult(1, 1)

    assert await _run_job(name, work) == "processed 1, failed 1"
    row = await db_session.scalar(select(JobRun).where(JobRun.name == name))
    assert row is not None
    assert row.status == "partial"
    assert row.processed == 1
    assert row.failed == 1


async def test_failed_run_records_error_type(db_session: AsyncSession) -> None:
    name = "test.jobs.failed"

    async def work() -> PostingResult:
        raise ValueError("should not be persisted")

    with pytest.raises(ValueError):
        await _run_job(name, work)

    row = await db_session.scalar(select(JobRun).where(JobRun.name == name))
    assert row is not None
    assert row.status == "failed"
    assert row.error_type == "ValueError"


async def test_list_jobs_reports_never_run_and_stale(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    await _admin_login(client, db_session)

    response = await client.get("/api/v1/meta/jobs")
    assert response.status_code == 200, response.text
    assert len(response.json()) == len(JOB_INTERVALS)
    assert {row["state"] for row in response.json()} == {"never_run"}

    name = next(iter(JOB_INTERVALS))
    old = datetime.now(UTC) - timedelta(days=2)
    db_session.add(
        JobRun(
            name=name,
            started_at=old,
            finished_at=old,
            status="success",
            processed=1,
            failed=0,
        )
    )
    await db_session.flush()

    response = await client.get("/api/v1/meta/jobs")
    assert response.status_code == 200
    row = next(row for row in response.json() if row["name"] == name)
    assert row["state"] == "stale"


async def test_run_job_now_queues_known_and_404s_unknown(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
) -> None:
    await _admin_login(client, db_session)
    name = next(iter(JOB_INTERVALS))
    sent: list[str] = []

    def send_task(task_name: str):
        sent.append(task_name)

    monkeypatch.setattr(celery_app, "send_task", send_task)

    response = await client.post(f"/api/v1/meta/jobs/{name}/run")
    assert response.status_code == 202
    assert response.json() == {"status": "queued"}
    assert sent == [name]

    response = await client.post("/api/v1/meta/jobs/nope/run")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "job.not_found"


async def test_jobs_endpoints_require_admin(client: AsyncClient, db_session: AsyncSession) -> None:
    member, password = await make_user(db_session, email="jobs-member@example.com")
    await login_as(client, email=member.email, password=password)

    assert (await client.get("/api/v1/meta/jobs")).status_code == 403
    assert (await client.post("/api/v1/meta/jobs/nope/run")).status_code == 403
