# @citizenrun/api

The HTTP service: the `/v1` API built on Hono with OpenAPI route definitions, the web shell, public pages and preview images.

## Entry points

- `src/server.ts` starts the service.
- `src/scripts/gen-openapi.ts` writes `openapi.json`; `pnpm gen:api` also regenerates the client in `@citizenrun/shared`.

Nothing imports this package.

## Commands

```sh
pnpm --filter @citizenrun/api dev     # needs the compose stack and a migrated database
pnpm --filter @citizenrun/api test
pnpm --filter @citizenrun/api test:integration
pnpm --filter @citizenrun/api typecheck
```

Copy `.env.example` to `.env` for local development. Owner values are left empty there, and each outside service then runs in its development mode. Integration tests call the app in process and never read `.env`.

## Never imported here

- `@citizenrun/ai`: the API makes no AI call.
- `@citizenrun/pipeline`, `@citizenrun/worker`, `@citizenrun/mobile` or any other app.

It may import `@citizenrun/shared`, `@citizenrun/db`, `@citizenrun/cards` and `@citizenrun/rules`.
