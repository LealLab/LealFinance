"""Interactive first-run setup: writes `.env`, then starts the stack.

Run from the repository root (normally via `task install:wizard`, which also
runs automatically before `task install`/`task install:tls`/`task up` when
`.env` is missing):

    task install:wizard              # interactive
    task install:wizard -- --yes     # accept every default, no prompts
    task install:wizard -- --env-only --path docker

Every optional block (SMTP, AI providers, exchange-rate/market-data keys) is
skipped by default - answering "no" preserves existing values, falling back
to `.env.example` on a fresh install. `.env.example` is the source of defaults,
comments, and key order: this script only fills in values, it never
restructures the file. An existing `.env` is read first (its values become
the new defaults) and backed up to `.env.bak` before being overwritten.

Stdlib only, no project dependencies - this has to run before `uv sync` /
`pnpm install` even happen.
"""

from __future__ import annotations

import argparse
import getpass
import os
import re
import secrets
import shlex
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import warnings
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV_EXAMPLE = ROOT / ".env.example"
ENV_PATH = ROOT / ".env"
ENV_BACKUP = ROOT / ".env.bak"

PLACEHOLDER_SECRET = "change-me-to-a-random-64-char-string"  # noqa: S105 - not a real secret
PLACEHOLDER_PASSWORD = "change-me"  # noqa: S105

_KEY_RE = re.compile(r"^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$")
SECRET_KEYS = {
    "POSTGRES_PASSWORD",
    "API_SECRET_KEY",
    "SMTP_PASSWORD",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "OPENEXCHANGERATES_APP_ID",
    "TWELVE_DATA_API_KEY",
    "BRAPI_TOKEN",
}

# --- Prompting (same pattern as backend/scripts/seed.py) ---------------------


def ask(label: str, default: str, use_default: bool, *, secret: bool = False) -> str:
    if use_default:
        return default
    if secret:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            raw = getpass.getpass(f"{label} [Enter to keep current/generated value]: ")
    else:
        raw = input(f"{label} [{default}]: ").strip()
    return raw or default


def ask_bool(label: str, default: bool, use_default: bool) -> bool:
    raw = ask(label, "yes" if default else "no", use_default)
    return raw.strip().lower() in {"y", "yes", "true", "1"}


# --- .env parsing / rendering -------------------------------------------------


def parse_env_file(path: Path) -> dict[str, str]:
    """Read `KEY=value` pairs, ignoring blank lines and comments."""
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        values[key.strip()] = value.strip()
    return values


def render_env(example_text: str, values: dict[str, str]) -> str:
    """Fill `.env.example` with `values`, keeping every comment and ordering.

    A key present in `values` replaces its line (uncommenting it if needed);
    every other line - comments, blanks, keys with no answer - passes through
    unchanged.
    """
    lines = []
    remaining = dict(values)
    for line in example_text.splitlines():
        match = _KEY_RE.match(line)
        if match and match.group(2) in values:
            lines.append(f"{match.group(2)}={values[match.group(2)]}")
            remaining.pop(match.group(2), None)
        else:
            lines.append(line)
    lines.extend(f"{key}={value}" for key, value in remaining.items())
    return "\n".join(lines) + "\n"


def validate(values: dict[str, str], *, tls: bool = False) -> tuple[list[str], list[str]]:
    """Mirror backend/app/core/config.py's production guard plus the
    Compose-level requirements the wizard can check before writing anything.
    Returns (errors, warnings).
    """
    errors: list[str] = []
    warnings: list[str] = []
    production = values.get("ENVIRONMENT") == "production"

    if production:
        secret = values.get("API_SECRET_KEY", "").strip()
        if not secret or secret == PLACEHOLDER_SECRET:
            errors.append("API_SECRET_KEY must be replaced in production")
        password = values.get("POSTGRES_PASSWORD", "").strip()
        if not password or password == PLACEHOLDER_PASSWORD:
            errors.append("POSTGRES_PASSWORD must be replaced in production")
        origins = [o.strip() for o in values.get("API_CORS_ORIGINS", "").split(",")]
        if "*" in origins:
            errors.append("CORS wildcard is not allowed in production")
        app_base_url = values.get("APP_BASE_URL", "")
        if (
            app_base_url
            and not app_base_url.startswith("https://")
            and "localhost" not in app_base_url
        ):
            warnings.append(
                "APP_BASE_URL is not https:// on a non-localhost host - "
                "session/CSRF cookies are Secure in production and login will "
                "silently fail over plain HTTP"
            )

    smtp_host = values.get("SMTP_HOST", "").strip()
    if smtp_host and not values.get("APP_BASE_URL", "").strip():
        errors.append("APP_BASE_URL is required when SMTP_HOST is set")

    if tls and not values.get("LF_SITE_ADDRESS", "").strip():
        errors.append("LF_SITE_ADDRESS is required to terminate TLS with Caddy")

    try:
        test_db = shlex.split(values.get("POSTGRES_TEST_DB", ""), comments=True)
    except ValueError:
        errors.append("POSTGRES_TEST_DB has invalid quoting")
    else:
        if test_db and (len(test_db) != 1 or not test_db[0].endswith("_test")):
            errors.append("POSTGRES_TEST_DB must end in _test")

    return errors, warnings


# --- Environment / system helpers --------------------------------------------


def which_ok(name: str) -> bool:
    return shutil.which(name) is not None


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.3)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def parse_port(value: str, fallback: int) -> int:
    """WEB_PORT may be a bare port or a host-prefixed "127.0.0.1:8081"."""
    try:
        return int(value.rsplit(":", 1)[-1])
    except ValueError:
        return fallback


def volume_exists(substring: str) -> bool:
    # ponytail: substring match on `docker volume ls`, not the exact
    # project-prefixed name (which varies with the checkout's directory
    # name). Good enough to avoid clobbering a live password; switch to
    # `docker compose config` if a false negative ever bites.
    if not which_ok("docker"):
        return False
    try:
        out = subprocess.run(
            ["docker", "volume", "ls", "--format", "{{.Name}}"],
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
    except (subprocess.SubprocessError, OSError):
        return False
    return any(substring in line for line in out.stdout.splitlines())


def wait_for_app(url: str, timeout: int = 120) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=3) as resp:  # noqa: S310
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, OSError, TimeoutError):
            pass
        time.sleep(2)
    return False


def run_task(*args: str) -> int:
    return subprocess.run(["task", *args], cwd=ROOT, check=False).returncode


# --- Interactive flow ----------------------------------------------------------


def preflight(path_choice: str) -> None:
    tools = ["docker", "task"]
    if path_choice == "native":
        tools += ["uv", "pnpm", "node"]
    print("\nChecking required tools:")
    for tool in tools:
        print(f"  {'v' if which_ok(tool) else 'x'} {tool}")
    if which_ok("docker"):
        ok = (
            subprocess.run(
                ["docker", "compose", "version"], capture_output=True, check=False
            ).returncode
            == 0
        )
        print(f"  {'v' if ok else 'x'} docker compose")
    print()


def gather_values(
    defaults: dict[str, str], path_choice: str, use_default: bool, *, tls: bool | None = None
) -> tuple[dict[str, str], bool]:
    """Ask the prompt blocks in order. Returns (values, tls_enabled)."""
    values: dict[str, str] = {}
    production = path_choice == "homelab"
    values["ENVIRONMENT"] = "production" if production else "development"

    print("-- Basics --")
    values["DEFAULT_CURRENCY"] = ask(
        "Default currency (ISO 4217)", defaults.get("DEFAULT_CURRENCY", "BRL"), use_default
    )
    values["DEFAULT_LOCALE"] = ask(
        "Default locale", defaults.get("DEFAULT_LOCALE", "pt-BR"), use_default
    )
    values["LOG_LEVEL"] = ask("Log level", defaults.get("LOG_LEVEL", "INFO"), use_default)

    print("\n-- Database --")
    values["POSTGRES_USER"] = ask(
        "Postgres user", defaults.get("POSTGRES_USER", "lealfinance"), use_default
    )
    values["POSTGRES_DB"] = ask(
        "Postgres database", defaults.get("POSTGRES_DB", "lealfinance"), use_default
    )
    if volume_exists("db_data"):
        print("  A database volume already exists - keeping POSTGRES_PASSWORD as-is")
        print("  (Postgres only reads this on first init; changing it here locks you out.)")
        values["POSTGRES_PASSWORD"] = defaults.get("POSTGRES_PASSWORD", PLACEHOLDER_PASSWORD)
    else:
        existing_pw = defaults.get("POSTGRES_PASSWORD", "")
        pw_default = (
            existing_pw
            if existing_pw and existing_pw != PLACEHOLDER_PASSWORD
            else secrets.token_urlsafe(24)
        )
        values["POSTGRES_PASSWORD"] = ask("Postgres password", pw_default, use_default, secret=True)
    if path_choice != "homelab":
        values["POSTGRES_HOST_PORT"] = ask(
            "Postgres host port", defaults.get("POSTGRES_HOST_PORT", "55433"), use_default
        )
        values["REDIS_HOST_PORT"] = ask(
            "Redis host port", defaults.get("REDIS_HOST_PORT", "6379"), use_default
        )

    print("\n-- Security --")
    existing_secret = defaults.get("API_SECRET_KEY", "")
    if existing_secret and existing_secret != PLACEHOLDER_SECRET:
        print("  Keeping existing API_SECRET_KEY")
        values["API_SECRET_KEY"] = existing_secret
    else:
        values["API_SECRET_KEY"] = secrets.token_urlsafe(48)
        print("  Generated a new API_SECRET_KEY.")
        print("  Rotating this later invalidates sessions, invitations, stored")
        print("  provider credentials, and outstanding MCP tokens.")

    tls_enabled = False
    if path_choice == "native":
        values["API_CORS_ORIGINS"] = "http://localhost:4200"
    else:
        print("\n-- Access --")
        values["WEB_PORT"] = ask("Web port", defaults.get("WEB_PORT", "8081"), use_default)
        if path_choice == "homelab":
            values["APP_BASE_URL"] = ask(
                "Public URL (e.g. https://finance.example.com)",
                defaults.get("APP_BASE_URL", ""),
                use_default,
            )
            values["TAG"] = ask(
                "Release tag (latest follows new releases; or pin e.g. v1.2.3)",
                defaults.get("TAG", "latest"),
                use_default,
            )
            tls_enabled = (
                tls
                if tls is not None
                else ask_bool(
                    "Terminate TLS with the bundled Caddy proxy?",
                    bool(defaults.get("LF_SITE_ADDRESS")),
                    use_default,
                )
            )
            if tls_enabled:
                values["LF_SITE_ADDRESS"] = ask(
                    "Site hostname for Caddy (no scheme)",
                    defaults.get("LF_SITE_ADDRESS", ""),
                    use_default,
                )
                values["WEB_PORT"] = "127.0.0.1:8081"
            values["API_CORS_ORIGINS"] = values["APP_BASE_URL"] or defaults.get(
                "API_CORS_ORIGINS", ""
            )
        else:
            values["API_CORS_ORIGINS"] = f"http://localhost:{values['WEB_PORT']}"

    print("\n-- Email (SMTP) --")
    if ask_bool("Configure outgoing email for invitations?", False, use_default):
        values["SMTP_HOST"] = ask("SMTP host", defaults.get("SMTP_HOST", ""), use_default)
        values["SMTP_PORT"] = ask("SMTP port", defaults.get("SMTP_PORT", "587"), use_default)
        values["SMTP_USERNAME"] = ask(
            "SMTP username", defaults.get("SMTP_USERNAME", ""), use_default
        )
        values["SMTP_PASSWORD"] = ask(
            "SMTP password", defaults.get("SMTP_PASSWORD", ""), use_default, secret=True
        )
        values["SMTP_STARTTLS"] = (
            "true" if ask_bool("Use STARTTLS?", True, use_default) else "false"
        )
        values["SMTP_FROM"] = ask("From address", defaults.get("SMTP_FROM", ""), use_default)
        if not values.get("APP_BASE_URL"):
            values["APP_BASE_URL"] = ask(
                "Public URL (required for invitation links)",
                defaults.get("APP_BASE_URL", ""),
                use_default,
            )
    else:
        print("  Skipped - keeping existing email settings.")

    print("\n-- AI providers --")
    if ask_bool("Enable optional AI chat providers?", False, use_default):
        values["AGENTS_ENABLED"] = "true"
        values["ANTHROPIC_API_KEY"] = ask(
            "Anthropic API key", defaults.get("ANTHROPIC_API_KEY", ""), use_default, secret=True
        )
        values["OPENAI_API_KEY"] = ask(
            "OpenAI API key", defaults.get("OPENAI_API_KEY", ""), use_default, secret=True
        )
        values["OLLAMA_BASE_URL"] = ask(
            "Ollama base URL", defaults.get("OLLAMA_BASE_URL", ""), use_default
        )
        values["AGENTS_DEFAULT_PROVIDER"] = ask(
            "Default provider", defaults.get("AGENTS_DEFAULT_PROVIDER", ""), use_default
        )
        if ask_bool("Also start the bundled Ollama container?", False, use_default):
            values["COMPOSE_PROFILES"] = "agents"
    else:
        print("  Skipped - keeping existing AI settings.")

    print("\n-- Exchange rates / market data --")
    if ask_bool("Configure exchange-rate and market-data provider keys?", False, use_default):
        values["OPENEXCHANGERATES_APP_ID"] = ask(
            "Open Exchange Rates app ID",
            defaults.get("OPENEXCHANGERATES_APP_ID", ""),
            use_default,
            secret=True,
        )
        values["TWELVE_DATA_API_KEY"] = ask(
            "Twelve Data API key", defaults.get("TWELVE_DATA_API_KEY", ""), use_default, secret=True
        )
        values["BRAPI_TOKEN"] = ask(
            "Brapi token", defaults.get("BRAPI_TOKEN", ""), use_default, secret=True
        )
    else:
        print("  Skipped - keeping existing provider settings.")

    values["UPDATE_CHECK_ENABLED"] = (
        "true"
        if ask_bool(
            "\nCheck GitHub for newer releases?",
            defaults.get("UPDATE_CHECK_ENABLED", "true").lower() == "true",
            use_default,
        )
        else "false"
    )

    return values, tls_enabled


def check_ports(values: dict[str, str], path_choice: str, use_default: bool) -> None:
    checks = []
    if "WEB_PORT" in values:
        checks.append(("WEB_PORT", parse_port(values["WEB_PORT"], 8081)))
    if path_choice != "homelab":
        checks.append(
            ("POSTGRES_HOST_PORT", parse_port(values.get("POSTGRES_HOST_PORT", "55433"), 55433))
        )
        checks.append(("REDIS_HOST_PORT", parse_port(values.get("REDIS_HOST_PORT", "6379"), 6379)))
    for label, port in checks:
        if not port_free(port):
            print(
                f"  ! port {port} ({label}) looks busy - stop whatever is using it, "
                "or re-run and pick another"
            )


def summarize(values: dict[str, str]) -> None:
    print("\nAbout to write .env:")
    for key, value in sorted(values.items()):
        shown = "***" if key in SECRET_KEYS and value else value
        print(f"  {key}={shown}")


def start_stack(path_choice: str, tls_enabled: bool, values_for_url: dict[str, str]) -> None:
    if path_choice == "native":
        subprocess.run(
            ["docker", "compose", "up", "-d", "postgres", "redis"], cwd=ROOT, check=False
        )
        print("Waiting for postgres/redis to become healthy...")
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            out = subprocess.run(
                ["docker", "compose", "ps", "--status", "running", "--services"],
                cwd=ROOT,
                capture_output=True,
                text=True,
                check=False,
            )
            if {"postgres", "redis"} <= set(out.stdout.split()):
                break
            time.sleep(2)
        run_task("backend:sync")
        run_task("backend:migrate")
        print("\nNext steps:")
        print("  task frontend:install   # once")
        print("  task backend:seed       # optional demo data")
        print("  task backend:dev        # terminal 1")
        print("  task frontend:dev       # terminal 2")
        return

    if path_choice == "docker":
        code = run_task("up")
    else:
        code = run_task("install:tls" if tls_enabled else "install")
    if code != 0:
        print("Stack failed to start - see the output above.")
        return

    port = parse_port(values_for_url.get("WEB_PORT", "8081"), 8081)
    url = f"http://127.0.0.1:{port}"
    print(f"\nWaiting for {url} to answer...")
    if wait_for_app(f"{url}/api/v1/auth/setup-status"):
        print(f"Up. Open {url} - the first account you register becomes the administrator.")
    else:
        print(
            "Still not answering after 120s. Check `docker compose logs -f` - "
            f"the app may be at {url}."
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Interactive first-run setup: writes .env, then starts the stack."
    )
    parser.add_argument(
        "-y", "--yes", action="store_true", help="Accept every default without prompting."
    )
    parser.add_argument(
        "--path", choices=["native", "docker", "homelab"], help="Skip the install-path question."
    )
    parser.add_argument(
        "--tls",
        action=argparse.BooleanOptionalAction,
        help="Set homelab TLS mode without prompting.",
    )
    parser.add_argument(
        "--env-only", action="store_true", help="Write .env and stop; do not start anything."
    )
    parser.add_argument(
        "--ensure-env",
        action="store_true",
        help="Internal: no-op if .env exists, otherwise run the prompts and stop.",
    )
    args = parser.parse_args()
    if args.tls and args.path != "homelab":
        parser.error("--tls requires --path homelab")

    if args.ensure_env and ENV_PATH.exists():
        return 0

    print("LealFinance setup wizard")
    path_choice = args.path or (
        "native"
        if args.yes
        else ask(
            "Install path - native dev / docker (all-in-Docker dev) / homelab",
            "native",
            False,
        )
    )
    if path_choice not in {"native", "docker", "homelab"}:
        print(f"Unknown path '{path_choice}', defaulting to native.")
        path_choice = "native"

    preflight(path_choice)

    existing = parse_env_file(ENV_PATH)
    defaults = {**parse_env_file(ENV_EXAMPLE), **existing}
    values, tls_enabled = gather_values(defaults, path_choice, args.yes, tls=args.tls)

    while True:
        errors, warnings = validate({**defaults, **values}, tls=tls_enabled)
        for warning in warnings:
            print(f"\nWarning: {warning}")
        if not errors:
            break
        print("\nBefore writing .env, fix:")
        for error in errors:
            print(f"  - {error}")
        if args.yes:
            print("Aborting: --yes cannot fix these without prompting.")
            return 1
        print("\nGoing through the prompts again with your previous answers as defaults.\n")
        values, tls_enabled = gather_values(
            {**defaults, **values}, path_choice, args.yes, tls=args.tls
        )

    check_ports(values, path_choice, args.yes)
    summarize(values)
    if not args.yes and not ask_bool("\nWrite .env now?", True, False):
        print("Aborted - nothing written.")
        return 1

    if ENV_PATH.exists():
        shutil.copy(ENV_PATH, ENV_BACKUP)
        print(f"Backed up previous .env to {ENV_BACKUP.name}")

    ENV_PATH.write_text(
        render_env(ENV_EXAMPLE.read_text(encoding="utf-8"), {**existing, **values}),
        encoding="utf-8",
    )
    print(f"Wrote {ENV_PATH}")

    if args.env_only or args.ensure_env:
        return 0

    # Task exported the old .env. Let Compose and nested Task reload the saved file,
    # including its quoting/interpolation, instead of inheriting stale values.
    for key in defaults.keys() | values.keys():
        os.environ.pop(key, None)
    start_stack(path_choice, tls_enabled, values)
    return 0


if __name__ == "__main__":
    sys.exit(main())
