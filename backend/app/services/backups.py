"""Portable, current-user backup export, preview, and replacement."""

import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any, cast
from uuid import UUID

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import delete, func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from app.core.config import get_settings
from app.core.errors import AppError, ValidationAppError
from app.models.account import Account
from app.models.agent_credential import AgentCredential
from app.models.base import UserOwnedModel
from app.models.budget import Budget, BudgetAllocation, ExpectedIncome
from app.models.categorization_rule import CategorizationRule
from app.models.category import Category
from app.models.category_group import CategoryGroup
from app.models.goal import Goal
from app.models.institution import Institution
from app.models.investment import (
    InvestmentAsset,
    InvestmentTransaction,
    InvestmentWallet,
    MarketDataCredential,
)
from app.models.loan import Loan
from app.models.manual_rate import ManualRate
from app.models.recurring import RecurringRule
from app.models.transaction import Transaction
from app.models.user import User
from app.schemas.backup import (
    BackupExportResponse,
    BackupPreviewResponse,
    BackupRestoreResponse,
    BackupWarning,
)

BACKUP_FORMAT = "lealfinance.backup"
BACKUP_FORMAT_VERSION = 1
MAX_ARCHIVE_BYTES = 25 * 1024 * 1024


@dataclass(frozen=True)
class BackupTable:
    name: str
    model: type[UserOwnedModel]
    version: int = 1


# Dependency order for inserts; deletion uses the reverse. This registry is
# deliberately exhaustive and guarded by a test so a future user-owned table
# cannot silently disappear from backups.
BACKUP_TABLES = (
    BackupTable("institutions", Institution),
    BackupTable("accounts", Account),
    BackupTable("category_groups", CategoryGroup),
    BackupTable("categories", Category),
    BackupTable("categorization_rules", CategorizationRule),
    BackupTable("budgets", Budget),
    BackupTable("budget_allocations", BudgetAllocation),
    BackupTable("expected_income", ExpectedIncome),
    BackupTable("recurring_rules", RecurringRule),
    BackupTable("loans", Loan),
    BackupTable("goals", Goal),
    BackupTable("manual_rates", ManualRate),
    BackupTable("transactions", Transaction),
    BackupTable("investment_wallets", InvestmentWallet),
    BackupTable("investment_assets", InvestmentAsset),
    BackupTable("investment_transactions", InvestmentTransaction),
)

EXCLUDED_USER_OWNED_MODELS = {
    AgentCredential: "agent_credentials",
    MarketDataCredential: "market_data_credentials",
}

_PREFERENCE_FIELDS = (
    "locale",
    "theme",
    "base_currency",
    "display_currency",
    "investments_enabled",
    "balances_hidden",
)
_OBSOLETE_OPTIONAL_PREFERENCES = {"demo_data_enabled"}
_BASE_OMISSIONS = (
    "user_identity",
    "sessions",
    "invitations",
    "global_currencies_rates_quotes",
)
_TABLES_BY_DB_NAME = {table.name: table for table in BACKUP_TABLES}


class _IncompatibleBackup(ValueError):
    pass


@dataclass(frozen=True)
class _DecodedBackup:
    payload: dict[str, Any]
    encrypted: bool


def _serialized(value: object) -> object:
    if isinstance(value, (Decimal, UUID)):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def _deserialized(column: ColumnElement[Any], value: object) -> object:
    if value is None:
        return None
    python_type = column.type.python_type
    if python_type is UUID:
        return UUID(_require_string(value))
    if python_type is Decimal:
        return Decimal(_require_string(value))
    if python_type is datetime:
        return datetime.fromisoformat(_require_string(value))
    if python_type is date:
        return date.fromisoformat(_require_string(value))
    return value


def _require_string(value: object) -> str:
    if not isinstance(value, str):
        raise _IncompatibleBackup
    return value


def _require_dict(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or not all(isinstance(key, str) for key in value):
        raise _IncompatibleBackup
    return cast(dict[str, Any], value)


def _require_list(value: object) -> list[Any]:
    if not isinstance(value, list):
        raise _IncompatibleBackup
    return value


async def _credential_omissions(db: AsyncSession, user_id: UUID) -> list[str]:
    omissions = list(_BASE_OMISSIONS)
    for model, code in EXCLUDED_USER_OWNED_MODELS.items():
        count = await db.scalar(select(func.count(model.id)).where(model.user_id == user_id))
        if count:
            omissions.append(code)
    return omissions


async def export_backup(db: AsyncSession, user: User, *, encrypted: bool) -> BackupExportResponse:
    data: dict[str, object] = {}
    for table in BACKUP_TABLES:
        result = await db.execute(
            select(table.model).where(table.model.user_id == user.id).order_by(table.model.id)
        )
        rows = [
            {
                column.name: _serialized(getattr(row, column.name))
                for column in table.model.__table__.columns
                if column.name != "user_id"
            }
            for row in result.scalars().all()
        ]
        data[table.name] = {"version": table.version, "rows": rows}

    now = datetime.now(UTC)
    payload: dict[str, object] = {
        "app_version": get_settings().app_version,
        "exported_at": now.isoformat(),
        "preferences": {field: _serialized(getattr(user, field)) for field in _PREFERENCE_FIELDS},
        "omissions": await _credential_omissions(db, user.id),
        "data": data,
    }

    recovery_key: str | None = None
    envelope_payload: object = payload
    cipher: str | None = None
    if encrypted:
        recovery_key = Fernet.generate_key().decode("ascii")
        envelope_payload = (
            Fernet(recovery_key.encode("ascii")).encrypt(_json_bytes(payload)).decode("ascii")
        )
        cipher = "fernet"

    archive = {
        "format": BACKUP_FORMAT,
        "format_version": BACKUP_FORMAT_VERSION,
        "encrypted": encrypted,
        "cipher": cipher,
        "payload": envelope_payload,
    }
    _check_size(archive)
    return BackupExportResponse(
        filename=f"lealfinance-backup-{now:%Y%m%d-%H%M%S}.json",
        archive=archive,
        recovery_key=recovery_key,
    )


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def _check_size(archive: object) -> None:
    # ponytail: in-memory archives are intentionally capped; add streaming/background
    # jobs only if real user backups exceed this 25 MiB ceiling.
    if len(_json_bytes(archive)) > MAX_ARCHIVE_BYTES:
        raise AppError(code="backup.file_too_large")


def _decode_archive(archive: object, recovery_key: str | None) -> _DecodedBackup:
    _check_size(archive)
    try:
        envelope = _require_dict(archive)
    except _IncompatibleBackup as exc:
        raise AppError(code="backup.invalid_archive") from exc
    try:
        if envelope.get("format") != BACKUP_FORMAT:
            raise _IncompatibleBackup
        format_version = envelope.get("format_version")
        if type(format_version) is not int:
            raise _IncompatibleBackup
        if format_version != BACKUP_FORMAT_VERSION:
            raise AppError(code="backup.version_unsupported")
        encrypted = envelope.get("encrypted")
        if type(encrypted) is not bool:
            raise _IncompatibleBackup

        if encrypted:
            if envelope.get("cipher") != "fernet" or not isinstance(envelope.get("payload"), str):
                raise _IncompatibleBackup
            if not recovery_key:
                raise AppError(code="backup.recovery_key_required")
            try:
                decrypted = Fernet(recovery_key.strip().encode("ascii")).decrypt(
                    envelope["payload"].encode("ascii")
                )
            except (InvalidToken, ValueError, UnicodeError) as exc:
                raise AppError(code="backup.recovery_key_invalid") from exc
            try:
                payload = _require_dict(json.loads(decrypted))
            except (json.JSONDecodeError, UnicodeError, _IncompatibleBackup) as exc:
                raise AppError(code="backup.invalid_archive") from exc
        else:
            if envelope.get("cipher") is not None:
                raise _IncompatibleBackup
            payload = _require_dict(envelope.get("payload"))
    except _IncompatibleBackup as exc:
        raise AppError(code="backup.invalid_archive") from exc
    return _DecodedBackup(payload=_migrate_payload(format_version, payload), encrypted=encrypted)


def _migrate_payload(format_version: int, payload: dict[str, Any]) -> dict[str, Any]:
    """Sequential migration hook for future supported backup formats."""
    version = format_version
    migrated = payload
    migrations: dict[int, Callable[[dict[str, Any]], dict[str, Any]]] = {}
    while version < BACKUP_FORMAT_VERSION:
        migration = migrations.get(version)
        if migration is None:
            raise AppError(code="backup.version_unsupported")
        migrated = migration(migrated)
        version += 1
    return migrated


def _validate_payload(
    payload: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, dict[str, Any]], list[BackupWarning]]:
    try:
        app_version = payload.get("app_version")
        exported_at = payload.get("exported_at")
        if not isinstance(app_version, str) or not isinstance(exported_at, str):
            raise _IncompatibleBackup
        datetime.fromisoformat(exported_at)

        preferences = _require_dict(payload.get("preferences"))
        preference_keys = set(preferences)
        required_preferences = set(_PREFERENCE_FIELDS)
        if not required_preferences.issubset(preference_keys):
            raise _IncompatibleBackup
        unknown_preferences = preference_keys - required_preferences
        unsupported = unknown_preferences - _OBSOLETE_OPTIONAL_PREFERENCES
        if unsupported:
            raise _IncompatibleBackup
        warnings = [
            BackupWarning(code="obsolete_setting_skipped", params={"setting": setting})
            for setting in sorted(unknown_preferences)
        ]

        omissions = _require_list(payload.get("omissions"))
        if not all(isinstance(item, str) for item in omissions):
            raise _IncompatibleBackup
        if any(item in {"agent_credentials", "market_data_credentials"} for item in omissions):
            warnings.append(BackupWarning(code="credentials_reconnect"))

        data = _require_dict(payload.get("data"))
        if set(data) != {table.name for table in BACKUP_TABLES}:
            raise _IncompatibleBackup
        table_data: dict[str, dict[str, Any]] = {}
        for table in BACKUP_TABLES:
            block = _require_dict(data[table.name])
            if block.get("version") != table.version:
                raise _IncompatibleBackup
            rows = _require_list(block.get("rows"))
            expected_columns = {
                column.name for column in table.model.__table__.columns if column.name != "user_id"
            }
            typed_rows: list[dict[str, Any]] = []
            for raw_row in rows:
                row = _require_dict(raw_row)
                if set(row) != expected_columns:
                    raise _IncompatibleBackup
                typed_rows.append(row)
            table_data[table.name] = {"rows": typed_rows}
        return preferences, table_data, warnings
    except (ValueError, TypeError, _IncompatibleBackup) as exc:
        raise _IncompatibleBackup from exc


def _id_maps(table_data: dict[str, dict[str, Any]]) -> dict[str, dict[UUID, UUID]]:
    maps: dict[str, dict[UUID, UUID]] = {}
    for table in BACKUP_TABLES:
        mapping: dict[UUID, UUID] = {}
        for row in cast(list[dict[str, Any]], table_data[table.name]["rows"]):
            old_id = UUID(_require_string(row["id"]))
            if old_id in mapping:
                raise _IncompatibleBackup
            mapping[old_id] = uuid.uuid4()
        maps[table.name] = mapping
    return maps


async def _replace(
    db: AsyncSession,
    user_id: UUID,
    preferences: dict[str, Any],
    table_data: dict[str, dict[str, Any]],
) -> dict[str, int]:
    maps = _id_maps(table_data)
    user = await db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise _IncompatibleBackup

    for table in reversed(BACKUP_TABLES):
        await db.execute(delete(table.model).where(table.model.user_id == user_id))

    for field in _PREFERENCE_FIELDS:
        setattr(user, field, preferences[field])

    counts: dict[str, int] = {}
    for table in BACKUP_TABLES:
        rows = cast(list[dict[str, Any]], table_data[table.name]["rows"])
        for raw_row in rows:
            values: dict[str, object] = {"user_id": user_id}
            for column in table.model.__table__.columns:
                if column.name == "user_id":
                    continue
                if column.name == "id":
                    values[column.name] = maps[table.name][
                        UUID(_require_string(raw_row[column.name]))
                    ]
                    continue
                value = _deserialized(column, raw_row[column.name])
                for foreign_key in column.foreign_keys:
                    target_table = foreign_key.target_fullname.partition(".")[0]
                    if target_table not in _TABLES_BY_DB_NAME or value is None:
                        continue
                    old_foreign_id = cast(UUID, value)
                    try:
                        value = maps[target_table][old_foreign_id]
                    except KeyError as exc:
                        raise _IncompatibleBackup from exc
                values[column.name] = value
            db.add(table.model(**values))
        await db.flush()
        counts[table.name] = len(rows)
    return counts


def _incompatible() -> ValidationAppError:
    return ValidationAppError(code="backup.data_incompatible")


async def preview_backup(
    db: AsyncSession, user: User, archive: object, recovery_key: str | None
) -> BackupPreviewResponse:
    decoded = _decode_archive(archive, recovery_key)
    try:
        preferences, table_data, warnings = _validate_payload(decoded.payload)
        savepoint = await db.begin_nested()
        try:
            counts = await _replace(db, user.id, preferences, table_data)
        finally:
            await savepoint.rollback()
        await db.refresh(user)
    except (_IncompatibleBackup, SQLAlchemyError, ValueError, TypeError) as exc:
        raise _incompatible() from exc
    return BackupPreviewResponse(
        source_app_version=cast(str, decoded.payload["app_version"]),
        exported_at=cast(str, decoded.payload["exported_at"]),
        encrypted=decoded.encrypted,
        counts=counts,
        warnings=warnings,
    )


async def restore_backup(
    db: AsyncSession, user: User, archive: object, recovery_key: str | None
) -> BackupRestoreResponse:
    decoded = _decode_archive(archive, recovery_key)
    try:
        preferences, table_data, warnings = _validate_payload(decoded.payload)
        counts = await _replace(db, user.id, preferences, table_data)
        await db.commit()
    except (_IncompatibleBackup, SQLAlchemyError, ValueError, TypeError) as exc:
        await db.rollback()
        raise _incompatible() from exc
    return BackupRestoreResponse(counts=counts, warnings=warnings)
