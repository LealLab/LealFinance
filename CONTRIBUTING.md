# Contributing

Thanks for helping improve LealFinance. Keep changes focused, follow the
existing architecture, and include validation evidence with every pull request.

## Prerequisites

- Python 3.13 and [uv](https://docs.astral.sh/uv/)
- Node 24 and pnpm 11.13.0
- Docker and Docker Compose
- [Task](https://taskfile.dev/) for the repository shortcuts

See [`docs/development.md`](docs/development.md) for the complete local setup,
including the Postgres and Redis configuration required by backend tests.

## Development checks

Run the checks relevant to your change before opening a pull request:

| Area | Command |
| --- | --- |
| Backend lint and formatting | `task backend:lint` |
| Backend type checking | `task backend:typecheck` |
| Backend tests | `task backend:test` |
| Frontend lint | `task frontend:lint` |
| Frontend tests | `task frontend:test` |
| Frontend production build | `task frontend:build` |
| Translation keys | `task i18n:validate` |

If you change migrations, run the upgrade/downgrade round trip described in
[`docs/development.md`](docs/development.md). If you add user-facing text,
update both supported translation files and run the translation-key check.

## Pull requests

1. Create a focused branch from `main`.
2. Make the smallest change that fully addresses the issue.
3. Update documentation when commands, behavior, or public interfaces change.
4. Run the relevant checks and record them in the pull request description.
5. Include screenshots for user-interface changes when they clarify the result.

Do not include credentials, tokens, private data, or environment-specific
secrets in commits, issues, or pull requests. Do not report security
vulnerabilities through public issues; follow [`SECURITY.md`](SECURITY.md).
