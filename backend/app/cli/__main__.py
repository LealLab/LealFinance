"""One-time administrator bootstrap.

Usage:
    python -m app.cli create-admin --email you@example.com --display-name "You"
    docker compose exec api python -m app.cli create-admin --email ... --display-name ...

Registration is invite-only (see app/services/auth.py) - this is the only
way to create the first user, and it refuses to run once any administrator
already exists.
"""

import argparse
import asyncio
import getpass
import sys

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select

# Same Windows event-loop caveat as alembic/env.py and tests/conftest.py:
# psycopg's async mode needs the selector loop, not the proactor loop
# Windows defaults to.
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from app.core.db import session_scope  # noqa: E402

# Same validator LoginRequest/RegisterRequest use (app/schemas/auth.py) -
# validated here too so a bootstrap admin can never end up with an email
# that later fails validation at login and locks them out.
_EmailAdapter = TypeAdapter(EmailStr)
from app.core.security import hash_password, normalize_email  # noqa: E402
from app.models.user import ROLE_ADMIN, User  # noqa: E402

_MIN_PASSWORD_LENGTH = 12


async def _create_admin(email: str, display_name: str, password: str) -> None:
    normalized = normalize_email(email)
    async with session_scope() as db:
        existing_admin = await db.execute(select(User).where(User.role == ROLE_ADMIN))
        if existing_admin.scalars().first() is not None:
            print("An administrator already exists; refusing to create another.", file=sys.stderr)
            raise SystemExit(1)

        existing_email = await db.execute(select(User).where(User.normalized_email == normalized))
        if existing_email.scalars().first() is not None:
            print(f"A user with email {email!r} already exists.", file=sys.stderr)
            raise SystemExit(1)

        user = User(
            email=email.strip(),
            normalized_email=normalized,
            password_hash=hash_password(password),
            display_name=display_name.strip(),
            role=ROLE_ADMIN,
        )
        db.add(user)
        await db.commit()

    print(f"Created administrator {email}.")


def _prompt_password() -> str:
    while True:
        password = getpass.getpass("Password: ")
        if len(password) < _MIN_PASSWORD_LENGTH:
            print(f"Password must be at least {_MIN_PASSWORD_LENGTH} characters.", file=sys.stderr)
            continue
        confirm = getpass.getpass("Confirm password: ")
        if password != confirm:
            print("Passwords did not match.", file=sys.stderr)
            continue
        return password


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create_admin = subparsers.add_parser(
        "create-admin", help="Create the first administrator (one-time bootstrap)."
    )
    create_admin.add_argument("--email", required=True)
    create_admin.add_argument("--display-name", required=True)

    args = parser.parse_args()

    if args.command == "create-admin":
        try:
            _EmailAdapter.validate_python(args.email)
        except ValidationError as exc:
            reason = exc.errors()[0]["msg"]
            print(f"{args.email!r} is not a valid email address: {reason}", file=sys.stderr)
            raise SystemExit(1) from exc

        # Never a CLI argument - that would land in shell history and `ps`.
        password = _prompt_password()
        asyncio.run(_create_admin(args.email, args.display_name, password))


if __name__ == "__main__":
    main()
