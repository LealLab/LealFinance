from datetime import datetime

from pydantic import BaseModel, ConfigDict


class JobHealthRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    name: str
    state: str
    status: str | None
    started_at: datetime | None
    finished_at: datetime | None
    processed: int
    failed: int
    error_type: str | None
    interval_seconds: int
