"""Account CRUD and archive/unarchive.

Accounts can be deleted only as part of an institution cascade; there is no
standalone per-account delete endpoint.
"""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.account import Account
from app.schemas.account import AccountBalanceRead, AccountCreate, AccountRead, AccountUpdate
from app.schemas.common import ArchiveRequest
from app.services import accounts as accounts_service

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountRead])
async def list_accounts(user: CurrentUser, db: DbSession) -> list[Account]:
    return await accounts_service.list_accounts(db, user.id)


@router.post("", response_model=AccountRead, status_code=status.HTTP_201_CREATED)
async def create_account(payload: AccountCreate, user: CurrentUser, db: DbSession) -> Account:
    return await accounts_service.create_account(db, user.id, payload)


# Declared before /{account_id} - otherwise FastAPI tries to parse
# "balances" as a UUID path param and this route never matches.
@router.get("/balances", response_model=list[AccountBalanceRead])
async def get_account_balances(
    user: CurrentUser, db: DbSession, as_of: date | None = None
) -> list[accounts_service.AccountBalance]:
    return await accounts_service.account_balances(db, user.id, as_of=as_of)


@router.get("/real-balances", response_model=list[AccountBalanceRead])
async def get_real_balances(
    user: CurrentUser, db: DbSession
) -> list[accounts_service.AccountBalance]:
    return await accounts_service.real_balance_contributions(db, user.id, today=date.today())


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
