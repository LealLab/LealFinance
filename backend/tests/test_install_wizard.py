"""Tests for scripts/wizard.py's pure render/validate logic.

The wizard deliberately lives outside the backend package (it has to run
before `uv sync` even happens), so it is loaded here by file path rather than
imported normally. Only `render_env` and `validate` are covered - the rest of
the script is interactive prompting and subprocess calls to `docker`/`task`,
not worth mocking out.
"""

import importlib.util
from pathlib import Path

_SPEC = importlib.util.spec_from_file_location(
    "wizard", Path(__file__).parents[2] / "scripts" / "wizard.py"
)
assert _SPEC and _SPEC.loader
wizard = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(wizard)


EXAMPLE = """\
# comment
ENVIRONMENT=development          # development | production
POSTGRES_PASSWORD=change-me
# TAG=v1.2.3
# POSTGRES_TEST_DB=lealfinance_test
SMTP_HOST=
"""


def test_render_env_fills_in_answers_and_keeps_everything_else() -> None:
    rendered = wizard.render_env(
        EXAMPLE, {"ENVIRONMENT": "production", "POSTGRES_PASSWORD": "s3cret"}
    )
    lines = rendered.splitlines()
    assert lines[0] == "# comment"
    assert lines[1] == "ENVIRONMENT=production"
    assert lines[2] == "POSTGRES_PASSWORD=s3cret"
    assert lines[3] == "# TAG=v1.2.3"  # no answer given, stays commented
    assert lines[4] == "# POSTGRES_TEST_DB=lealfinance_test"
    assert lines[5] == "SMTP_HOST="


def test_render_env_uncomments_a_key_when_answered() -> None:
    rendered = wizard.render_env(EXAMPLE, {"TAG": "v2.0.0"})
    assert "TAG=v2.0.0" in rendered.splitlines()


def test_validate_rejects_placeholder_secret_in_production() -> None:
    errors, _ = wizard.validate(
        {
            "ENVIRONMENT": "production",
            "API_SECRET_KEY": wizard.PLACEHOLDER_SECRET,
            "POSTGRES_PASSWORD": "real",
            "API_CORS_ORIGINS": "https://example.com",
        }
    )
    assert any("API_SECRET_KEY" in e for e in errors)


def test_validate_rejects_placeholder_password_in_production() -> None:
    errors, _ = wizard.validate(
        {
            "ENVIRONMENT": "production",
            "API_SECRET_KEY": "real-secret",
            "POSTGRES_PASSWORD": wizard.PLACEHOLDER_PASSWORD,
            "API_CORS_ORIGINS": "https://example.com",
        }
    )
    assert any("POSTGRES_PASSWORD" in e for e in errors)


def test_validate_rejects_cors_wildcard_in_production() -> None:
    errors, _ = wizard.validate(
        {
            "ENVIRONMENT": "production",
            "API_SECRET_KEY": "real-secret",
            "POSTGRES_PASSWORD": "real",
            "API_CORS_ORIGINS": "*",
        }
    )
    assert any("CORS" in e for e in errors)


def test_validate_requires_app_base_url_with_smtp_host() -> None:
    errors, _ = wizard.validate({"ENVIRONMENT": "development", "SMTP_HOST": "smtp.example.com"})
    assert any("APP_BASE_URL" in e for e in errors)


def test_validate_requires_site_address_for_tls() -> None:
    errors, _ = wizard.validate({"ENVIRONMENT": "production"}, tls=True)
    assert any("LF_SITE_ADDRESS" in e for e in errors)


def test_validate_rejects_test_db_without_suffix() -> None:
    errors, _ = wizard.validate({"ENVIRONMENT": "development", "POSTGRES_TEST_DB": "lealfinance"})
    assert any("POSTGRES_TEST_DB" in e for e in errors)


def test_validate_passes_a_clean_development_setup() -> None:
    errors, warnings = wizard.validate(
        {
            "ENVIRONMENT": "development",
            "API_SECRET_KEY": wizard.PLACEHOLDER_SECRET,
            "POSTGRES_PASSWORD": wizard.PLACEHOLDER_PASSWORD,
            "API_CORS_ORIGINS": "http://localhost:4200",
        }
    )
    assert errors == []
    assert warnings == []


def test_validate_warns_on_non_https_public_url_in_production() -> None:
    _, warnings = wizard.validate(
        {
            "ENVIRONMENT": "production",
            "API_SECRET_KEY": "real-secret",
            "POSTGRES_PASSWORD": "real",
            "API_CORS_ORIGINS": "http://finance.example.com",
            "APP_BASE_URL": "http://finance.example.com",
        }
    )
    assert warnings


def test_parse_port_handles_host_prefixed_value() -> None:
    assert wizard.parse_port("127.0.0.1:8081", 8080) == 8081
    assert wizard.parse_port("8081", 8080) == 8081
    assert wizard.parse_port("not-a-port", 8080) == 8080
