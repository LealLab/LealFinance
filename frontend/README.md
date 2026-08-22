# Frontend

The Angular frontend uses standalone, zoneless components, Transloco, and
HTTP-backed repositories. The repository-level guide is canonical:
[`docs/development.md`](../docs/development.md).

From this directory:

```bash
pnpm install
pnpm start
pnpm run lint
pnpm run test
pnpm run build
pnpm run e2e
```

The development server runs on `http://localhost:4200` and proxies `/api` to
`http://localhost:8000`. Install Chromium before running the smoke test:

```bash
pnpm exec playwright install chromium
```
