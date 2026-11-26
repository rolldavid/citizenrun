# @citizenrun/rules

State filing-deadline rules and the date library they are written with: pure functions and data.
Given an election, a state's module computes its filing dates, fees and signature counts, each
with the statute it comes from. The package also holds the turnout classifier the pipeline calls
when it writes elections and results.

Nothing here reads the clock, the environment, the network or a file. Time arrives as an argument.

## Entry point

- `@citizenrun/rules` (`src/index.ts`): the rules interface, the date helpers and the classifier.

## Tests

    pnpm --filter @citizenrun/rules run test

Each state's module is tested against fixtures taken from official election calendars, each
with the link to its source.

## Never import

- Any workspace package other than `@citizenrun/shared`.
- Any `node:*` module or other Node built-in, a database client, or a parsing library.
