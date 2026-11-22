# @citizenrun/mobile

The Expo app: one codebase for iOS, Android and the web.

## Commands

```sh
pnpm --filter @citizenrun/mobile dev        # Expo dev server on port 8081 (web and development builds)
pnpm --filter @citizenrun/mobile ios        # local development build on the iOS simulator or an iPhone
pnpm --filter @citizenrun/mobile android    # local development build on the Android emulator or a phone
pnpm --filter @citizenrun/mobile build:web  # single-page web export into dist/
pnpm --filter @citizenrun/mobile typecheck  # phone, web and Node type checks
pnpm exec vitest run --project unit:mobile  # unit tests, from the repository root
```

Expo Go is never used: the app runs only as a development build (D-030). `APP_VARIANT`
(`development`, the default, `staging` or `production`) selects the identifiers in `app.config.ts`;
copy `.env.example` to `.env` to set it locally.

## Layout

- `app/` holds Expo Router route files only, one per URL. There is no `src/app`.
- `src/` holds features, the design system, client libraries and platform modules.
- Only `src/platform/` branches on platform: no `Platform.OS`, `Platform.select` or platform file
  suffix anywhere else.
- `index.ts` is the entry: the random-values and plural-rules polyfills, then Expo Router.

## Imports

The app may import `@citizenrun/shared` and `@citizenrun/cards`. It never imports
`@citizenrun/db`, `@citizenrun/rules`, `@citizenrun/ai`, the pipeline, the API or the worker.
