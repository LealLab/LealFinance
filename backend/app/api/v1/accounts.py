"""Account CRUD and archive/unarchive - no delete (accounts are archived,
never removed, matching the frontend's AccountRepository)."""

from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.account import Account
from app.schemas.account import AccountCreate, AccountRead, AccountUpdate
from app.schemas.common import ArchiveRequest
from app.services import accounts as accounts_service

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountRead])
async def list_accounts(user: CurrentUser, db: DbSession) -> list[Account]:
    return await accounts_service.list_accounts(db, user.id)


@router.post("", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
async def create_account(payload: AccountCreate, user: CurrentUser, db: DbSession) -> Account:
    return await accounts_service.create_account(db, user.id, payload)


@router.get("/{account_id}", response_model=AccountRead)
async def get_account(account_id: UUID, user: CurrentUser, db: DbSession) -> Account:
    return await accounts_service.get_account(db, user.id, account_id)


@router.patch("/{account_id}", response_model=AccountRead)
async def update_account(
    account_id: UUID, payload: AccountUpdate, user: CurrentUser, db: DbSession
) -> Account:
    return await accounts_service.update_account(db, user.id, account_id, payload)


@router.post("/{account_id}/archive", response_model=AccountRead)
async def archive_account(
    account_id: UUID, payload: ArchiveRequest, user: CurrentUser, db: DbSession
) -> Account:
    return await accounts_service.set_account_archived(db, user.id, account_id, payload.archived)
