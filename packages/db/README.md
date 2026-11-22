# @citizenrun/db

The database package: the Drizzle schema, the SQL migrations and the runner that applies them, the seed runner, shared query fragments and the integration-test harness.

## Entry points

| Entry                    | Holds                                                                           | Imported by                                         |
| ------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| `@citizenrun/db`         | The schema, the pool and `Db` types, query fragments                            | `@citizenrun/api`, `@citizenrun/worker`, `scripts/` |
| `@citizenrun/db/testing` | One migrated template database per run, one clone per test worker, test buckets | Integration tests only                              |

Migrations are forward-only SQL files in `migrations/`. A merged migration is never edited.

## Commands

```sh
pnpm db:migrate          # apply migrations to DATABASE_URL
pnpm db:seed             # load the seed data
pnpm db:reset            # drop, migrate and seed a local database
pnpm --filter @citizenrun/db test
pnpm --filter @citizenrun/db test:integration
```

Copy `.env.example` to `.env` for the local stack. Integration tests need the compose stack (`docker compose up -d --wait`) and never read `.env`.

## Never imported here

- Any workspace package other than `@citizenrun/shared`.
- Anything from `apps/` or `pipeline/`.

Only the API, the worker and `scripts/` import this package. The pipeline and the app never do.
