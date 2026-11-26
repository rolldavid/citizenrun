# @citizenrun/pipeline

The data pipeline: it reads public datasets and official web pages, checks what it finds and
writes stage outputs and bundles to its home bucket. The app's worker loads the published
bundles; the pipeline itself never touches the app.

## Running a command

    pnpm pipeline <command> [--state <ST,ST|all>] [--dry-run]

Run with no command to print the list of commands. A local run reads `pipeline/.env`; copy it
from `pipeline/.env.example`, which points at the local store's `data` bucket.

## Tests

    pnpm --filter @citizenrun/pipeline run test               unit tests
    pnpm --filter @citizenrun/pipeline run test:integration   integration tests

The integration tests need the local object store (`docker compose up -d --wait`). They create
their own buckets, named `t-<run>-<slot>-<name>`, and delete them when the run ends.

## Rules

- The pipeline never imports `@citizenrun/db`, `pg`, `drizzle-orm`, `pg-boss` or
  `@citizenrun/cards`, and never connects to an app database.
- No file outside `lib/fetch/` makes a request. Every outside request goes through the
  fetcher, which follows the crawl policy in `docs/crawl-policy.md`.
- `cli.ts` is the only file that writes to the console; everything else logs through the logger.
- `env.ts` is the only file that reads the environment, apart from the test harness in
  `testing/`.
