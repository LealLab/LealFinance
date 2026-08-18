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
