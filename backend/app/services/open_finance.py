"""Pluggy item lifecycle; transaction syncing is a later stage."""

from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationAppError
from app.models.institution import Institution
from app.models.open_finance import PluggyAccount, PluggyItem
from app.schemas.institution import InstitutionCreate
from app.services import accounts as accounts_service
from app.services import institutions, ownership, pluggy_client, pluggy_credentials

DisconnectMode = Literal["keep", "delete"]


async def _api_key(db: AsyncSession, user_id: UUID) -> str:
    client_id, client_secret, _environment = await pluggy_credentials.get_credentials(db, user_id)
    return await pluggy_client.authenticate(client_id, client_secret)


def _required_string(payload: dict[str, Any], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value:
        raise ValidationAppError(code="pluggy.request_failed")
    return value


def _connector_id(item: dict[str, Any]) -> int:
    connector = item.get("connector")
    value = item.get("connectorId")
    if isinstance(connector, dict) and value is None:
        value = connector.get("id")
    if not isinstance(value, (str, int)):
        raise ValidationAppError(code="pluggy.request_failed")
    try:
        return int(value)
    except ValueError as exc:
        raise ValidationAppError(code="pluggy.request_failed") from exc


def _as_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValidationAppError(code="pluggy.request_failed")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationAppError(code="pluggy.request_failed") from exc


async def _institution_for_connector(
    db: AsyncSession, user_id: UUID, connector_name: str
) -> Institution:
    for institution in await institutions.list_institutions(db, user_id):
        if institution.name == connector_name:
            return institution
    return await institutions.create_institution(
        db,
        user_id,
        InstitutionCreate(name=connector_name, icon="bank"),
    )


async def create_connect_token(db: AsyncSession, user_id: UUID, item_id: str | None = None) -> str:
    return await pluggy_client.create_connect_token(await _api_key(db, user_id), item_id)


async def register_item(db: AsyncSession, user_id: UUID, external_id: str) -> PluggyItem:
    api_key = await _api_key(db, user_id)
    payload = await pluggy_client.get_item(api_key, external_id)
    connector_id = _connector_id(payload)
    connector = await pluggy_client.get_connector(api_key, connector_id)
    connector_name = _required_string(connector, "name")
    item_external_id = _required_string(payload, "id")
    institution = await _institution_for_connector(db, user_id, connector_name)

    item = await db.scalar(
        ownership.owned(PluggyItem, user_id).where(PluggyItem.external_id == item_external_id)
    )
    if item is None:
        item = PluggyItem(user_id=user_id, external_id=item_external_id)
        db.add(item)

    item.connector_id = connector_id
    item.connector_name = connector_name
    item.connector_image_url = connector.get("imageUrl") or connector.get("image_url")
    item.status = _required_string(payload, "status")
    item.execution_status = payload.get("executionStatus")
    item.status_detail = payload.get("statusDetail")
    item.institution_id = institution.id
    item.consent_expires_at = _as_datetime(payload.get("consentExpiresAt"))
    await db.commit()
    await db.refresh(item)
    return item


async def list_items(db: AsyncSession, user_id: UUID) -> list[PluggyItem]:
    return list(await ownership.list_owned(db, PluggyItem, user_id))


async def get_item(db: AsyncSession, user_id: UUID, item_id: UUID) -> PluggyItem:
    return await ownership.get_owned(db, PluggyItem, item_id, user_id)


async def list_accounts(db: AsyncSession, user_id: UUID, item_id: UUID) -> list[PluggyAccount]:
    await get_item(db, user_id, item_id)
    result = await db.scalars(
        ownership.owned(PluggyAccount, user_id).where(PluggyAccount.pluggy_item_id == item_id)
    )
    return list(result.all())


async def disconnect_item(
    db: AsyncSession, user_id: UUID, item_id: UUID, mode: DisconnectMode
) -> None:
    item = await get_item(db, user_id, item_id)
    await pluggy_client.delete_item(await _api_key(db, user_id), item.external_id)

    result = await db.scalars(
        ownership.owned(PluggyAccount, user_id).where(PluggyAccount.pluggy_item_id == item.id)
    )
    pluggy_accounts = list(result.all())
    account_ids = [row.account_id for row in pluggy_accounts if row.account_id is not None]
    if mode == "delete":
        await accounts_service.cascade_delete_accounts(db, user_id, account_ids, commit=False)
    else:
        for row in pluggy_accounts:
            row.account_id = None

    await db.execute(delete(PluggyAccount).where(PluggyAccount.pluggy_item_id == item.id))
    await db.delete(item)
    await db.commit()
