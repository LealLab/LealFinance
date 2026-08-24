"""Response schema for the update-availability check."""

from pydantic import BaseModel


class UpdateStatusRead(BaseModel):
    current_version: str
    latest_version: str | None
    update_available: bool
    release_url: str | None
