# @citizenrun/worker

The job service: every pg-boss queue and schedule, the operations checks and their alert emails, and the backup script.

## Entry points

- `src/main.ts` starts the worker: one pg-boss instance, the queues and schedules of its registry, the heartbeat and the drain on shutdown.
- `src/backup/main.ts` is the backup job, bundled on its own.

Nothing imports this package.

## Commands

```sh
pnpm --filter @citizenrun/worker dev     # needs the compose stack and a migrated database
pnpm --filter @citizenrun/worker test
pnpm --filter @citizenrun/worker test:integration
pnpm --filter @citizenrun/worker typecheck
```

Copy `.env.example` to `.env` for local development. Owner values are left empty there, and each outside service then runs in its development mode: email is held in memory and never sent. Integration tests run jobs in process and never read `.env`.

## Never imported here

- `@citizenrun/pipeline`, `@citizenrun/api`, `@citizenrun/mobile` or any other app.
- `@citizenrun/shared/api`: the generated client belongs to the app.
- `@anthropic-ai/sdk`: AI calls go through `@citizenrun/ai` only.

It may import `@citizenrun/shared`, `@citizenrun/db`, `@citizenrun/cards`, `@citizenrun/rules` and `@citizenrun/ai`.
