"""Institution CRUD, archive/unarchive, and referentially-guarded delete."""

from uuid import UUID

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.models.institution import Institution
from app.schemas.common import ArchiveRequest
from app.schemas.institution import InstitutionCreate, InstitutionRead, InstitutionUpdate
from app.services import institutions as institutions_service

router = APIRouter(prefix="/institutions", tags=["institutions"])


@router.get("", response_model=list[InstitutionRead])
async def list_institutions(user: CurrentUser, db: DbSession) -> list[Institution]:
    return await institutions_service.list_institutions(db, user.id)


@router.post("", response_model=InstitutionRead, status_code=status.HTTP_201_CREATED)
async def create_institution(
    payload: InstitutionCreate, user: CurrentUser, db: DbSession
) -> Institution:
    return await institutions_service.create_institution(db, user.id, payload)


@router.get("/{institution_id}", response_model=InstitutionRead)
async def get_institution(institution_id: UUID, user: CurrentUser, db: DbSession) -> Institution:
    return await institutions_service.get_institution(db, user.id, institution_id)


@router.patch("/{institution_id}", response_model=InstitutionRead)
async def update_institution(
    institution_id: UUID, payload: InstitutionUpdate, user: CurrentUser, db: DbSession
) -> Institution:
    return await institutions_service.update_institution(db, user.id, institution_id, payload)


@router.post("/{institution_id}/archive", response_model=InstitutionRead)
async def archive_institution(
    institution_id: UUID, payload: ArchiveRequest, user: CurrentUser, db: DbSession
) -> Institution:
    return await institutions_service.set_institution_archived(
        db, user.id, institution_id, payload.archived
    )


@router.delete("/{institution_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_institution(institution_id: UUID, user: CurrentUser, db: DbSession) -> None:
    await institutions_service.delete_institution(db, user.id, institution_id)
