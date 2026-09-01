"""Application settings, read from environment / .env.

A single Settings instance (get_settings()) is the source of truth for
configuration. Nothing else in the app should read os.environ directly.
"""

from functools import lru_cache
from typing import Literal, Self

from pydantic import computed_field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file="../.env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- General ---
    environment: Literal["development", "production", "test"] = "development"
    log_level: str = "INFO"
    default_currency: str = "BRL"
    default_locale: str = "pt-BR"

    # --- Postgres ---
    postgres_user: str = "lealfinance"
    postgres_password: str = "change-me"
    postgres_db: str = "lealfinance"
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    database_url: str | None = None

    # --- Redis ---
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    redis_url: str | None = None

    # --- API ---
    api_secret_key: str = "change-me-to-a-random-64-char-string"
    api_cors_origins: str = "http://localhost:4200"

    # --- Auth / sessions ---
    session_ttl_days: int = 30
    invitation_ttl_days: int = 7
    # How long a browser stays exempt from the TOTP challenge after the user
    # ticks "trust this device". Trust is opt-in per login, so this only ever
    # applies to devices the user deliberately marked.
    trusted_device_ttl_days: int = 30

    # --- AI Agents (optional, off by default) ---
    agents_enabled: bool = False
    # Instance-wide provider credentials - a per-user row in
    # agent_credentials (app/models/agent_credential.py) always takes
    # precedence over these; see app/agents/credentials.py.
    anthropic_api_key: str | None = None
    openai_api_key: str | None = None
    ollama_base_url: str | None = None
    agents_default_provider: str | None = None

    # --- Currency conversion (optional) ---
    # Free key from https://openexchangerates.org/signup/free. Without one,
    # cross-currency rates fall back to 1:1 - see app/services/exchange_rates.py.
    openexchangerates_app_id: str | None = None
    # Minimum gap between manual refreshes (POST /meta/exchange-rates/refresh).
    # The free plan updates hourly and caps usage at ~1,000 requests/month, so
    # lowering this trades quota for freshness the provider may not have yet.
    exchange_rate_refresh_cooldown_minutes: int = 15
    # Optional live quote-provider keys; per-user credentials take precedence.
    twelve_data_api_key: str | None = None
    brapi_token: str | None = None

    # --- Update check (optional) ---
    # Baked into the image by the release workflow; "dev" for source builds,
    # which never report an available update.
    app_version: str = "dev"
    # Anonymous GET to this project's public GitHub releases API. No instance
    # data leaves the machine; set false for air-gapped installs.
    update_check_enabled: bool = True

    @model_validator(mode="after")
    def reject_production_placeholders(self) -> Self:
        if self.environment != "production":
            return self
        if not self.api_secret_key.strip() or self.api_secret_key == (
            "change-me-to-a-random-64-char-string"
        ):
            raise ValueError("API_SECRET_KEY must be replaced in production")
        if (
            not self.postgres_password.strip()
            or self.postgres_password == "change-me"
            or (self.database_url is not None and "change-me" in self.database_url)
        ):
            raise ValueError("POSTGRES_PASSWORD or DATABASE_URL must be replaced in production")
        return self

    @computed_field  # type: ignore[prop-decorator]
    @property
    def sqlalchemy_database_uri(self) -> str:
        if self.database_url:
            return self.database_url
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @computed_field  # type: ignore[prop-decorator]
    @property
    def celery_broker_url(self) -> str:
        if self.redis_url:
            return self.redis_url
        return f"redis://{self.redis_host}:{self.redis_port}/{self.redis_db}"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
