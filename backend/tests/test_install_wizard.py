"""Tests for scripts/wizard.py's configuration and setup flow.

The wizard deliberately lives outside the backend package (it has to run
before `uv sync` even happens), so it is loaded here by file path rather than
imported normally. Startup is stubbed so these tests never start services.
"""

import importlib.util
from pathlib import Path

import pytest

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


@pytest.mark.parametrize("test_db", ["custom_test", '"custom_test"', "custom_test # tests"])
def test_rerun_preserves_configuration_and_drops_stale_environment(
    tmp_path, monkeypatch, test_db
) -> None:
    env = tmp_path / ".env"
    original = (
        "SMTP_HOST=smtp.example.invalid\n"
        "APP_BASE_URL=https://finance.example.invalid\n"
        "AGENTS_ENABLED=true\n"
        "SESSION_TTL_DAYS=5\n"
        f"POSTGRES_TEST_DB={test_db}\n"
        "UPDATE_CHECK_ENABLED=false\n"
        "CUSTOM_SETTING=keep-me\n"
        "WEB_PORT=8081\n"
    )
    env.write_text(original, encoding="utf-8")
    backup = tmp_path / ".env.bak"
    monkeypatch.setattr(wizard, "ENV_PATH", env)
    monkeypatch.setattr(wizard, "ENV_BACKUP", backup)
    monkeypatch.setattr(wizard, "preflight", lambda _: None)
    monkeypatch.setattr(wizard, "check_ports", lambda *args: None)
    monkeypatch.setattr(wizard, "volume_exists", lambda _: False)
    monkeypatch.setattr(wizard.sys, "argv", ["wizard.py", "--yes", "--path", "homelab"])
    # Simulate Task's dotenv export without reading the developer's environment.
    monkeypatch.setattr(wizard.os, "environ", {"WEB_PORT": "8081", "PATH": "keep-path"})
    original_ask = wizard.ask
    monkeypatch.setattr(
        wizard,
        "ask",
        lambda label, *args, **kwargs: (
            "9090" if label == "Web port" else original_ask(label, *args, **kwargs)
        ),
    )
    started = []

    def start(path, tls, values):
        assert "WEB_PORT" not in wizard.os.environ
        assert wizard.os.environ["PATH"] == "keep-path"
        assert wizard.parse_env_file(env)["WEB_PORT"] == values["WEB_PORT"] == "9090"
        started.append(path)

    monkeypatch.setattr(wizard, "start_stack", start)
    assert wizard.main() == 0
    saved = wizard.parse_env_file(env)
    for key, expected in {
        "SMTP_HOST": "smtp.example.invalid",
        "AGENTS_ENABLED": "true",
        "SESSION_TTL_DAYS": "5",
        "POSTGRES_TEST_DB": test_db,
        "UPDATE_CHECK_ENABLED": "false",
        "CUSTOM_SETTING": "keep-me",
    }.items():
        assert saved[key] == expected
    assert backup.read_text(encoding="utf-8") == original
    assert started == ["homelab"]


@pytest.mark.parametrize(
    "path,tls_flag,expected_mode,expected_tls",
    [
        ("homelab", "--no-tls", "production", False),
        ("homelab", "--tls", "production", True),
        ("docker", "--no-tls", "development", False),
    ],
)
def test_ensure_env_uses_requested_install_mode(
    tmp_path, monkeypatch, path, tls_flag, expected_mode, expected_tls
) -> None:
    env = tmp_path / ".env"
    monkeypatch.setattr(wizard, "ENV_PATH", env)
    monkeypatch.setattr(wizard, "preflight", lambda _: None)
    monkeypatch.setattr(wizard, "check_ports", lambda *args: None)
    monkeypatch.setattr(wizard, "volume_exists", lambda _: False)
    monkeypatch.setattr(wizard.sys, "argv", ["wizard.py", "--ensure-env", "--path", path, tls_flag])
    prompts = []

    def answer(prompt):
        prompts.append(prompt)
        if prompt.startswith("Site hostname"):
            return "finance.example.invalid"
        return ""

    monkeypatch.setattr("builtins.input", answer)
    monkeypatch.setattr(wizard.getpass, "getpass", lambda _: "")
    assert wizard.main() == 0
    saved = wizard.parse_env_file(env)
    assert saved["ENVIRONMENT"] == expected_mode
    assert bool(saved["LF_SITE_ADDRESS"]) == expected_tls
    assert not any(p.startswith(("Install path", "Terminate TLS")) for p in prompts)
    if expected_tls:
        assert saved["WEB_PORT"] == "127.0.0.1:8081"


def test_secret_prompts_and_summary_hide_credentials(monkeypatch, capsys) -> None:
    prompts = []

    def hidden_input(prompt):
        prompts.append(prompt)
        return ""

    monkeypatch.setattr(wizard.getpass, "getpass", hidden_input)
    assert wizard.ask("Password", "synthetic-private-value", False, secret=True) == (
        "synthetic-private-value"
    )
    assert "synthetic-private-value" not in prompts[0]
    wizard.summarize(dict.fromkeys(wizard.SECRET_KEYS, "synthetic-private-value"))
    output = capsys.readouterr().out
    assert "synthetic-private-value" not in output
    assert output.count("=***") == len(wizard.SECRET_KEYS)


def test_existing_configuration_is_validated_before_overwrite(tmp_path, monkeypatch) -> None:
    env = tmp_path / ".env"
    original = "POSTGRES_TEST_DB=unsafe_database\n"
    env.write_text(original, encoding="utf-8")
    monkeypatch.setattr(wizard, "ENV_PATH", env)
    monkeypatch.setattr(wizard, "preflight", lambda _: None)
    monkeypatch.setattr(wizard, "volume_exists", lambda _: False)
    monkeypatch.setattr(
        wizard.sys, "argv", ["wizard.py", "--yes", "--path", "docker", "--env-only"]
    )
    assert wizard.main() == 1
    assert env.read_text(encoding="utf-8") == original


def test_all_credential_questions_use_hidden_input(monkeypatch) -> None:
    hidden_labels = []
    monkeypatch.setattr(wizard, "volume_exists", lambda _: False)
    monkeypatch.setattr(wizard, "ask_bool", lambda *args: True)

    def answer(label, default, use_default, *, secret=False):
        if secret:
            hidden_labels.append(label)
        return default

    monkeypatch.setattr(wizard, "ask", answer)
    wizard.gather_values({}, "homelab", False, tls=False)
    assert set(hidden_labels) == {
        "Postgres password",
        "SMTP password",
        "Anthropic API key",
        "OpenAI API key",
        "Open Exchange Rates app ID",
        "Twelve Data API key",
        "Brapi token",
    }
