# Contributing

Thanks for helping improve LealFinance. Keep changes focused, follow the
existing architecture, and include validation evidence with every pull request.

## Prerequisites

- Python 3.13 and [uv](https://docs.astral.sh/uv/)
- Node 24 and pnpm 11.22.0
- Docker with the Compose plugin
- [Task](https://taskfile.dev/) for repository shortcuts

Follow [`docs/development.md`](docs/development.md) for local setup and the
database requirements used by backend tests.

## Checks

Run the checks relevant to your change:

| Area | Command |
| --- | --- |
| Backend lint and formatting | `task backend:lint` |
| Backend type checking | `task backend:typecheck` |
| Backend tests | `task backend:test` |
| Frontend lint | `task frontend:lint` |
| Frontend tests | `task frontend:test` |
| Frontend production build | `task frontend:build` |
| Translation keys | `task i18n:validate` |
| Dependency security audit | `task security:audit` |

Migration changes must pass the round-trip in
[`docs/development.md`](docs/development.md#migrations). User-facing text must
use Transloco and pass `task i18n:validate`.

## Pull requests

1. Create a focused branch from `main`.
2. Make the smallest change that fully addresses the issue.
3. Update documentation when commands, behavior, or public interfaces change.
4. Run the relevant checks and record them in the pull request description.
5. Include screenshots for user-interface changes when useful.

Never include credentials, tokens, private data, or environment-specific
secrets in commits, issues, or pull requests. Report vulnerabilities through
[`SECURITY.md`](SECURITY.md), not public issues.

## Releases

Cut a release from a green `main`. There is no dedicated release branch.

Tag and push:

```bash
git tag -a v1.2.3 -m "v1.2.3"
git push origin v1.2.3
```

Follow semver.

The tag push triggers [`.github/workflows/release.yml`](.github/workflows/release.yml),
which builds and publishes both GHCR images (`lealfinance-api`,
`lealfinance-web`) tagged with the version and `latest`, and creates the
matching GitHub Release with auto-generated notes. One push does both.
