# CitizenRun

CitizenRun is a civic app that shows every elected office in the United States, what it pays and how to run for it. It runs on phones and on the web, and everything it shows comes from public data.

## Running it locally

You need Node (the version in `.nvmrc`), pnpm and Docker with Compose.

```sh
docker compose up -d --wait
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

The first command starts Postgres and the object store. The last one starts the API, the worker and the Expo development server.

Every product identifier (the app's name, bundle ids, URL scheme and hosts) is defined in `brand.json`.

## Licence

The code is licensed under the Apache License 2.0; see `LICENSE` and `NOTICE`. The compiled civic data will carry its own licence, added with the first data bundle.

The code licence grants no rights to the project's name or logo.
