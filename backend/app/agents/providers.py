"""Static per-provider metadata. Three providers, one dataclass each - not
an ABC hierarchy, since there is exactly one implementation per provider
and no third-party plugin story.

Model lists here are UI suggestions only (the providers page shows them as
a datalist); `AgentCredential.model` / the env fallback's default_model
accept any string, so a new model release never needs a code change to be
usable, only to be suggested.
"""

from dataclasses import dataclass

from app.models.agent_credential import (
    AUTH_MODE_API_KEY,
    AUTH_MODE_NONE,
    AUTH_MODE_OAUTH,
    PROVIDER_ANTHROPIC,
    PROVIDER_OLLAMA,
    PROVIDER_OPENAI,
)


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    auth_modes: tuple[str, ...]
    default_model: str
    models: tuple[str, ...]


PROVIDERS: dict[str, ProviderSpec] = {
    PROVIDER_ANTHROPIC: ProviderSpec(
        id=PROVIDER_ANTHROPIC,
        auth_modes=(AUTH_MODE_API_KEY, AUTH_MODE_OAUTH),
        default_model="claude-sonnet-5",
        models=("claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"),
    ),
    PROVIDER_OPENAI: ProviderSpec(
        id=PROVIDER_OPENAI,
        auth_modes=(AUTH_MODE_API_KEY, AUTH_MODE_OAUTH),
        default_model="gpt-5.1",
        models=("gpt-5.1", "gpt-5.1-codex"),
    ),
    PROVIDER_OLLAMA: ProviderSpec(
        id=PROVIDER_OLLAMA,
        auth_modes=(AUTH_MODE_NONE,),
        default_model="llama3.1",
        models=(),
    ),
}
