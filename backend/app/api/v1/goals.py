"""Goal CRUD - metadata over a goal-type account. No delete; archive
only, matching the frontend's GoalRepository."""

from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.goal import Goal
from app.schemas.common import ArchiveRequest
from app.schemas.goal import (
    GoalCreate,
    GoalRead,
    GoalUpdate,
    GoalWithAccountCreate,
    GoalWithAccountRead,
    GoalWithAccountUpdate,
)
from app.services import goals as goals_service

router = APIRouter(prefix="/goals", tags=["goals"])


@router.post(
    "/with-account", response_model=GoalWithAccountRead, status_code=status.HTTP_201_CREATED
)
async def create_goal_with_account(
    payload: GoalWithAccountCreate, user: CurrentUser, db: DbSession
) -> dict[str, object]:
    goal, account = await goals_service.create_goal_with_account(db, user.id, payload)
    return {"goal": goal, "account": account}


@router.get("", response_model=list[GoalRead])
async def list_goals(user: CurrentUser, db: DbSession) -> list[Goal]:
    return await goals_service.list_goals(db, user.id)


@router.post("", response_model=GoalRead, status_code=status.HTTP_201_CREATED)
async def create_goal(payload: GoalCreate, user: CurrentUser, db: DbSession) -> Goal:
    return await goals_service.create_goal(db, user.id, payload)


@router.patch("/{goal_id}", response_model=GoalRead)
async def update_goal(goal_id: UUID, payload: GoalUpdate, user: CurrentUser, db: DbSession) -> Goal:
    return await goals_service.update_goal(db, user.id, goal_id, payload)


@router.patch("/{goal_id}/with-account", response_model=GoalWithAccountRead)
async def update_goal_with_account(
    goal_id: UUID, payload: GoalWithAccountUpdate, user: CurrentUser, db: DbSession
) -> dict[str, object]:
    goal, account = await goals_service.update_goal_with_account(db, user.id, goal_id, payload)
    return {"goal": goal, "account": account}


@router.post("/{goal_id}/archive", response_model=GoalWithAccountRead)
async def archive_goal(
    goal_id: UUID, payload: ArchiveRequest, user: CurrentUser, db: DbSession
) -> dict[str, object]:
    goal, account = await goals_service.set_goal_with_account_archived(
        db, user.id, goal_id, payload.archived
    )
    return {"goal": goal, "account": account}
