"""Application settings, read from environment / .env.

A single Settings instance (get_settings()) is the source of truth for
configuration. Nothing else in the app should read os.environ directly.
"""

from functools import lru_cache
from typing import Literal

from pydantic import computed_field
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

    # --- AI Agents (optional, off by default) ---
    agents_enabled: bool = False

    # --- Currency conversion (optional) ---
    # Free key from https://openexchangerates.org/signup/free. Without one,
    # cross-currency rates fall back to 1:1 — see app/services/exchange_rates.py.
    openexchangerates_app_id: str | None = None

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
