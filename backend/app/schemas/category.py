"""Category DTOs."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import IconName, PatchModel

CategoryKind = Literal["income", "expense"]


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    kind: CategoryKind
    group_id: UUID
    color: str
    icon: IconName
    position: int


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: CategoryKind
    group_id: UUID
    color: str = Field(min_length=1, max_length=9)
    icon: IconName
    # position is server-assigned (see app/services/categories.py) - not part
    # of the create payload, matching the frontend's Omit<Category, 'id' | 'position'>.


class CategoryUpdate(PatchModel):
    non_nullable_fields = frozenset({"name", "kind", "group_id", "color", "icon", "position"})

    name: str | None = Field(default=None, min_length=1, max_length=100)
    kind: CategoryKind | None = None
    group_id: UUID | None = None
    color: str | None = Field(default=None, min_length=1, max_length=9)
    icon: IconName | None = None
    position: int | None = None


class CategoryReorderRequest(BaseModel):
    kind: CategoryKind
    group_id: UUID
    ordered_ids: list[UUID]
