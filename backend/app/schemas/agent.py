"""AI provider DTOs. Secrets are never serialized here - every Read model
below exposes only booleans, the credential source, and a display label."""

from datetime import date, datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

ProviderId = Literal["anthropic", "openai", "ollama"]
ReasoningEffort = Literal["low", "medium", "high", "xhigh"]


class ProviderStatusRead(BaseModel):
    provider: ProviderId
    configured: bool
    source: Literal["user", "env", "none"]
    auth_mode: Literal["api_key", "oauth", "none"] | None
    auth_modes: list[str]
    account_label: str | None
    model: str
    default_model: str
    models: list[str]
    reasoning_effort: ReasoningEffort | None
    reasoning_efforts: list[str]


class ProviderLinkUpdate(BaseModel):
    """PUT body for api-key/local-provider linking. OAuth linking goes
    through the separate start/complete endpoints instead."""

    api_key: str | None = Field(default=None, min_length=1)
    base_url: str | None = Field(default=None, min_length=1, max_length=255)
    model: str | None = Field(default=None, min_length=1, max_length=128)
    reasoning_effort: ReasoningEffort | None = None


class OAuthStartRead(BaseModel):
    authorize_url: str
    verifier: str
    state: str


class OAuthCompleteCreate(BaseModel):
    verifier: str = Field(min_length=1)
    state: str = Field(min_length=1)
    code: str = Field(min_length=1)


class ProviderTestRead(BaseModel):
    ok: bool
    error_code: str | None = None


class McpTokenRead(BaseModel):
    token: str
    expires_at: datetime


class ConversationCreate(BaseModel):
    provider: ProviderId | None = None


class ConversationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str | None
    provider: str
    model: str
    status: str
    created_at: datetime
    updated_at: datetime


class AgentMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    role: str
    content: str
    tool_calls: list[dict[str, Any]] | None
    tool_call_id: str | None
    tool_name: str | None
    is_error: bool
    position: int
    created_at: datetime


class ConversationDetailRead(ConversationRead):
    messages: list[AgentMessageRead]


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    # The client's local calendar day, so "today" in the prompt matches the
    # user's timezone rather than the server's UTC. Falls back to the server
    # date when absent (e.g. an external MCP client).
    client_date: date | None = None


class ConfirmCreate(BaseModel):
    tool_call_id: str = Field(min_length=1)
    approved: bool
    arguments: dict[str, Any] | None = None
    client_date: date | None = None


class InstructionsRead(BaseModel):
    instructions: str | None


class InstructionsUpdate(BaseModel):
    # Empty clears the field; the router treats that as a delete and skips the
    # provider check so removal works even when no provider is reachable.
    instructions: str = Field(default="", max_length=2000)
