"""Institution DTOs."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import IconName


class InstitutionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    icon: IconName
    color: str | None
    archived: bool
    position: int


class InstitutionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    icon: IconName
    color: str | None = Field(default=None, max_length=9)
    archived: bool = False
    position: int = 0


class InstitutionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    icon: IconName | None = None
    color: str | None = Field(default=None, max_length=9)
    archived: bool | None = None
    position: int | None = None
