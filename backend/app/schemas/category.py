"""Category DTOs."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import IconName

CategoryKind = Literal["income", "expense"]


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    kind: CategoryKind
    parent_id: UUID | None
    color: str
    icon: IconName
    archived: bool
    position: int


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    kind: CategoryKind
    parent_id: UUID | None = None
    color: str = Field(min_length=1, max_length=9)
    icon: IconName
    archived: bool = False
    # position is server-assigned (see app/services/categories.py) - not
    # part of the create payload, matching the frontend's
    # Omit<Category, 'id' | 'position'>.


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    kind: CategoryKind | None = None
    parent_id: UUID | None = None
    color: str | None = Field(default=None, min_length=1, max_length=9)
    icon: IconName | None = None
    archived: bool | None = None
    position: int | None = None


class CategoryReorderRequest(BaseModel):
    kind: CategoryKind
    parent_id: UUID | None = None
    ordered_ids: list[UUID]
