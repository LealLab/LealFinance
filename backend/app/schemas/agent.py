"""AI provider DTOs. Secrets are never serialized here - every Read model
below exposes only booleans, the credential source, and a display label."""

from typing import Literal

from pydantic import BaseModel, Field

ProviderId = Literal["anthropic", "openai", "ollama"]
ChatRole = Literal["user", "assistant"]


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


class ProviderLinkUpdate(BaseModel):
    """PUT body for api-key/local-provider linking. OAuth linking goes
    through the separate start/complete endpoints instead."""

    api_key: str | None = Field(default=None, min_length=1)
    base_url: str | None = Field(default=None, min_length=1, max_length=255)
    model: str | None = Field(default=None, min_length=1, max_length=128)


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


class ChatMessageInput(BaseModel):
    role: ChatRole
    content: str = Field(min_length=1, max_length=8000)


class ChatCreate(BaseModel):
    provider: ProviderId | None = None
    messages: list[ChatMessageInput] = Field(min_length=1, max_length=50)


class ChatRead(BaseModel):
    provider: ProviderId
    model: str
    reply: str
