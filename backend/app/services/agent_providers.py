"""Provider linking, status, and the smoke-test chat call. Delegates the
credential-resolution precedence to app/agents/credentials.py and the
actual HTTP calls to app/agents/oauth.py / app/agents/chat.py - this
module is the CRUD + orchestration layer the router talks to.
"""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents import chat as chat_module
from app.agents import credentials, oauth
from app.agents.providers import PROVIDERS
from app.core.crypto import encrypt_secret
from app.core.errors import AppError, BadGatewayError, NotFoundError, ValidationAppError
from app.models.agent_credential import (
    AUTH_MODE_API_KEY,
    AUTH_MODE_NONE,
    AUTH_MODE_OAUTH,
    PROVIDER_OLLAMA,
    AgentCredential,
)
from app.schemas.agent import (
    ChatCreate,
    ChatRead,
    OAuthCompleteCreate,
    OAuthStartRead,
    ProviderLinkUpdate,
    ProviderStatusRead,
    ProviderTestRead,
)


def _require_known_provider(provider: str) -> None:
    if provider not in PROVIDERS:
        raise NotFoundError(code="agents.provider_unknown", params={"provider": provider})


async def _status(db: AsyncSession, user_id: UUID, provider: str) -> ProviderStatusRead:
    spec = PROVIDERS[provider]
    resolved = await credentials.resolve(db, user_id, provider)
    return ProviderStatusRead(
        provider=provider,
        configured=resolved is not None,
        source=resolved.source if resolved else "none",
        auth_mode=resolved.auth_mode if resolved else None,
        auth_modes=list(spec.auth_modes),
        account_label=resolved.account_label if resolved else None,
        model=resolved.model if resolved else spec.default_model,
        default_model=spec.default_model,
        models=[m.id for m in spec.models],
        reasoning_effort=resolved.reasoning_effort if resolved else None,
        reasoning_efforts=list(spec.reasoning_efforts),
    )


async def list_provider_status(db: AsyncSession, user_id: UUID) -> list[ProviderStatusRead]:
    return [await _status(db, user_id, provider) for provider in PROVIDERS]


async def link_api_key(
    db: AsyncSession, user_id: UUID, provider: str, data: ProviderLinkUpdate
) -> ProviderStatusRead:
    _require_known_provider(provider)

    row = await credentials.get_user_row(db, user_id, provider)

    # Changing the model or reasoning effort isn't re-linking: an existing
    # row keeps its auth_mode, tokens, and account id. Without this,
    # picking a model on an OAuth-linked provider would demand an API key
    # and destroy the subscription link.
    if row is not None and data.api_key is None and data.base_url is None:
        if data.model is not None and data.model != row.model:
            row.model = data.model
            # A model switch resets to that model's own default effort,
            # unless this same request also names one explicitly.
            row.reasoning_effort = data.reasoning_effort
        elif data.reasoning_effort is not None:
            row.reasoning_effort = data.reasoning_effort
        await db.commit()
        return await _status(db, user_id, provider)

    if provider == PROVIDER_OLLAMA:
        if not data.base_url:
            raise ValidationAppError(code="agents.base_url_required")
        auth_mode = AUTH_MODE_NONE
        secret_ciphertext = None
    else:
        if not data.api_key:
            raise ValidationAppError(code="agents.api_key_required")
        auth_mode = AUTH_MODE_API_KEY
        secret_ciphertext = encrypt_secret(data.api_key)

    if row is None:
        row = AgentCredential(user_id=user_id, provider=provider, auth_mode=auth_mode)
        db.add(row)
    else:
        row.auth_mode = auth_mode
        row.refresh_ciphertext = None
        row.expires_at = None
        row.account_id = None
        row.account_label = None

    row.secret_ciphertext = secret_ciphertext
    row.base_url = data.base_url
    row.model = data.model
    row.reasoning_effort = data.reasoning_effort
    await db.commit()
    return await _status(db, user_id, provider)


async def unlink(db: AsyncSession, user_id: UUID, provider: str) -> None:
    _require_known_provider(provider)
    row = await credentials.get_user_row(db, user_id, provider)
    if row is None:
        raise NotFoundError(code=f"{AgentCredential.__error_prefix__}.not_found")
    await db.delete(row)
    await db.commit()


def start_oauth(provider: str) -> OAuthStartRead:
    _require_known_provider(provider)
    if provider not in oauth.OAUTH_PROVIDERS:
        raise ValidationAppError(code="agents.oauth_unsupported")
    started = oauth.start(provider)
    return OAuthStartRead(
        authorize_url=started.authorize_url, verifier=started.verifier, state=started.state
    )


async def complete_oauth(
    db: AsyncSession, user_id: UUID, provider: str, data: OAuthCompleteCreate
) -> ProviderStatusRead:
    _require_known_provider(provider)
    if provider not in oauth.OAUTH_PROVIDERS:
        raise ValidationAppError(code="agents.oauth_unsupported")

    try:
        tokens = await oauth.complete(
            provider, verifier=data.verifier, state=data.state, code=data.code
        )
    except AppError:
        raise
    except Exception as exc:
        raise ValidationAppError(code="agents.oauth_failed") from exc

    row = await credentials.get_user_row(db, user_id, provider)
    if row is None:
        row = AgentCredential(user_id=user_id, provider=provider, auth_mode=AUTH_MODE_OAUTH)
        db.add(row)
    row.auth_mode = AUTH_MODE_OAUTH
    row.secret_ciphertext = encrypt_secret(tokens.access_token)
    row.refresh_ciphertext = encrypt_secret(tokens.refresh_token) if tokens.refresh_token else None
    row.expires_at = tokens.expires_at
    row.account_id = tokens.account_id
    row.account_label = tokens.account_label
    await db.commit()
    return await _status(db, user_id, provider)


async def test_provider(db: AsyncSession, user_id: UUID, provider: str) -> ProviderTestRead:
    _require_known_provider(provider)
    resolved = await credentials.resolve(db, user_id, provider)
    if resolved is None:
        return ProviderTestRead(ok=False, error_code="agents.not_configured")
    try:
        await chat_module.send_chat(resolved, [{"role": "user", "content": "ping"}])
    except BadGatewayError as exc:
        return ProviderTestRead(ok=False, error_code=exc.code)
    return ProviderTestRead(ok=True)


async def send_chat(db: AsyncSession, user_id: UUID, data: ChatCreate) -> ChatRead:
    provider = data.provider
    if provider is not None:
        _require_known_provider(provider)
        resolved = await credentials.resolve(db, user_id, provider)
    else:
        resolved = None
        for candidate in PROVIDERS:
            resolved = await credentials.resolve(db, user_id, candidate)
            if resolved is not None:
                break

    if resolved is None:
        raise ValidationAppError(code="agents.not_configured")

    messages = [{"role": m.role, "content": m.content} for m in data.messages]
    reply = await chat_module.send_chat(resolved, messages)
    return ChatRead(provider=resolved.provider, model=resolved.model, reply=reply)
