"""Category group DTOs."""

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.category import CategoryKind
from app.schemas.common import IconName, PatchModel


class CategoryGroupRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    kind: CategoryKind
    color: str
    icon: IconName
    position: int


class CategoryGroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: CategoryKind
    color: str = Field(min_length=1, max_length=9)
    icon: IconName


class CategoryGroupUpdate(PatchModel):
    non_nullable_fields = frozenset({"name", "kind", "color", "icon", "position"})

    name: str | None = Field(default=None, min_length=1, max_length=100)
    kind: CategoryKind | None = None
    color: str | None = Field(default=None, min_length=1, max_length=9)
    icon: IconName | None = None
    position: int | None = None


class CategoryGroupReorderRequest(BaseModel):
    kind: CategoryKind
    ordered_ids: list[UUID]
