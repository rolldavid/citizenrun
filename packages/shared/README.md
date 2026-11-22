# @citizenrun/shared

The contract between the app, the API, the worker and the pipeline: zod schemas, ids, the error-code registry, the logger and `redact()`, environment parsing, string catalogs, the brand module, design values and, later, the pure logic every side shares.

## Entry points

| Entry                        | Holds                                                    | Imported by                               |
| ---------------------------- | -------------------------------------------------------- | ----------------------------------------- |
| `@citizenrun/shared`         | Schemas, ids, errors, logger, i18n, brand, design values | Every package                             |
| `@citizenrun/shared/api`     | The generated API client and its hooks                   | `@citizenrun/mobile` only                 |
| `@citizenrun/shared/storage` | `createS3Client` and `ensureBucket`                      | Server code, scripts and the test harness |
| `@citizenrun/shared/testing` | Fake clock, zones, seeded random, the run marker         | Test files only                           |

The root entry runs in Hermes, browsers and Node, so it uses no `node:*` module and never reads `process`.

## Tests

```sh
pnpm --filter @citizenrun/shared test
pnpm --filter @citizenrun/shared typecheck
```

## Never imported here

- Any other workspace package: this package depends on none of them.
- In the root entry: `node:*` modules, `react-native`, Drizzle, `pg` or Hono.
- Anything from `apps/`.
