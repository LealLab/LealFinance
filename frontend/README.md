# Frontend

The Angular 22 frontend uses standalone, zoneless components, Transloco, and
HTTP-backed repositories. The repository-level development workflow is the
canonical guide: see [`docs/development.md`](../docs/development.md).

From this directory:

```bash
pnpm install
pnpm start       # development server at http://localhost:4200/
pnpm run lint
pnpm run test
pnpm run build
```

The production container builds the app with Node 24 and serves it through
nginx. There is no configured `ng e2e` command in this project.
