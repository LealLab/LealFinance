"""Static per-provider metadata. Three providers, one dataclass each - not
an ABC hierarchy, since there is exactly one implementation per provider
and no third-party plugin story.

Model lists here are UI suggestions only (the providers page shows them as
a `<select>`); `AgentCredential.model` / the env fallback's default_model
accept any string, so a new model release never needs a code change to be
usable, only to be suggested.

Reasoning effort works the same way: `reasoning_efforts` is what the
providers page offers, `ModelSpec.default_effort` is what a model falls
back to when the user hasn't picked one (None for models/providers with no
such concept, e.g. Ollama and most Anthropic models today).
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

REASONING_EFFORTS: tuple[str, ...] = ("low", "medium", "high", "xhigh")


@dataclass(frozen=True)
class ModelSpec:
    id: str
    default_effort: str | None = None


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    auth_modes: tuple[str, ...]
    default_model: str
    models: tuple[ModelSpec, ...]
    reasoning_efforts: tuple[str, ...] = ()


PROVIDERS: dict[str, ProviderSpec] = {
    PROVIDER_ANTHROPIC: ProviderSpec(
        id=PROVIDER_ANTHROPIC,
        auth_modes=(AUTH_MODE_API_KEY, AUTH_MODE_OAUTH),
        default_model="claude-sonnet-5",
        models=(
            ModelSpec("claude-opus-5"),
            ModelSpec("claude-sonnet-5"),
            ModelSpec("claude-haiku-4-5-20251001"),
        ),
        reasoning_efforts=REASONING_EFFORTS,
    ),
    PROVIDER_OPENAI: ProviderSpec(
        id=PROVIDER_OPENAI,
        auth_modes=(AUTH_MODE_API_KEY, AUTH_MODE_OAUTH),
        default_model="gpt-5.6-luna",
        models=(
            ModelSpec("gpt-5.6-luna", default_effort="high"),
            ModelSpec("gpt-5.6-sol", default_effort="medium"),
            ModelSpec("gpt-5.6-terra", default_effort="medium"),
            ModelSpec("gpt-5.5", default_effort="medium"),
        ),
        reasoning_efforts=REASONING_EFFORTS,
    ),
    PROVIDER_OLLAMA: ProviderSpec(
        id=PROVIDER_OLLAMA,
        auth_modes=(AUTH_MODE_NONE,),
        default_model="llama3.1",
        models=(),
    ),
}


def default_effort(provider: str, model: str) -> str | None:
    """The effort a model falls back to when a credential row has none
    stored - looked up by model id, not provider default_model, since the
    user may have picked a non-default model."""
    spec = PROVIDERS.get(provider)
    if spec is None:
        return None
    for m in spec.models:
        if m.id == model:
            return m.default_effort
    return None
