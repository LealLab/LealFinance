"""Celery beat coverage for system-wide Pluggy item synchronization."""

from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.open_finance_sync as open_finance_sync
from app.models.open_finance import PluggyItem
from app.workers.tasks import open_finance as open_finance_task
from tests.factories import make_user


def _item(user_id: UUID, external_id: str, last_synced_at: datetime | None) -> PluggyItem:
    return PluggyItem(
        user_id=user_id,
        external_id=external_id,
        connector_id=1,
        connector_name="Test Bank",
        status="UPDATED",
        last_synced_at=last_synced_at,
    )


async def test_syncs_stale_items_skips_fresh_and_continues_after_failure(
    db_session: AsyncSession,
    monkeypatch,
) -> None:
    failed_user, _ = await make_user(db_session, email="open-finance-task-failed@example.com")
    synced_user, _ = await make_user(db_session, email="open-finance-task-synced@example.com")
    now = datetime.now(UTC)
    failed = _item(failed_user.id, "item-failed", now - timedelta(hours=6))
    fresh = _item(synced_user.id, "item-fresh", now - timedelta(hours=1))
    later = _item(synced_user.id, "item-later", None)
    db_session.add_all([failed, fresh, later])
    await db_session.commit()
    failed_id = failed.id
    later_id = later.id

    calls: list[UUID] = []

    async def sync_item(_db: AsyncSession, _user_id: UUID, item_id: UUID) -> None:
        calls.append(item_id)
        if item_id == failed_id:
            raise RuntimeError("bad credentials")

    monkeypatch.setattr(open_finance_sync, "sync_item", sync_item)

    assert await open_finance_task._sync_stale_items(db_session) == (1, 1)
    assert set(calls) == {failed_id, later_id}

    failure = await db_session.scalar(select(PluggyItem).where(PluggyItem.id == failed_id))
    assert failure is not None
    assert failure.last_sync_error == "bad credentials"
