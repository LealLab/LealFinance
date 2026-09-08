import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_production_rejects_default_secrets() -> None:
    with pytest.raises(ValidationError, match="API_SECRET_KEY"):
        Settings(
            environment="production",
            api_secret_key="change-me-to-a-random-64-char-string",
            postgres_password="database-secret",
        )

    with pytest.raises(ValidationError, match="POSTGRES_PASSWORD"):
        Settings(
            environment="production",
            api_secret_key="api-secret",
            postgres_password="change-me",
        )


def test_production_accepts_replaced_secrets() -> None:
    settings = Settings(
        environment="production",
        api_secret_key="api-secret",
        postgres_password="database-secret",
        database_url="postgresql+psycopg://user:database-secret@localhost/db",
    )

    assert settings.environment == "production"


def test_production_rejects_wildcard_cors() -> None:
    with pytest.raises(ValidationError, match="CORS"):
        Settings(
            environment="production",
            api_secret_key="api-secret",
            postgres_password="database-secret",
            api_cors_origins="https://example.com, *",
        )


@pytest.fixture
def _no_email_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """A developer's .env (loaded into the process env by Taskfile's `dotenv`)
    may configure real SMTP. Drop it so these tests see only their kwargs."""
    for var in (
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USERNAME",
        "SMTP_PASSWORD",
        "SMTP_FROM",
        "SMTP_STARTTLS",
        "APP_BASE_URL",
    ):
        monkeypatch.delenv(var, raising=False)


def test_smtp_host_without_app_base_url_is_rejected(_no_email_env: None) -> None:
    with pytest.raises(ValidationError, match="APP_BASE_URL"):
        Settings(
            _env_file=None,
            environment="production",
            api_secret_key="api-secret",
            postgres_password="database-secret",
            database_url="postgresql+psycopg://user:database-secret@localhost/db",
            smtp_host="smtp.example.com",
        )


def test_smtp_host_with_app_base_url_enables_email(_no_email_env: None) -> None:
    settings = Settings(
        _env_file=None,
        environment="production",
        api_secret_key="api-secret",
        postgres_password="database-secret",
        database_url="postgresql+psycopg://user:database-secret@localhost/db",
        smtp_host="smtp.example.com",
        app_base_url="https://finance.example.com",
    )

    assert settings.email_enabled is True


def test_email_is_disabled_without_smtp_host(_no_email_env: None) -> None:
    assert Settings(_env_file=None).email_enabled is False
