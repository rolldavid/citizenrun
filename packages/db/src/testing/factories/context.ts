/** What a factory reads instead of the real clock: `now` is the test's current time. */
export type FactoryContext = { now: Date };

/** The default context: the real time truncated to the second, where a FakeClock starts. */
export function defaultFactoryContext(): FactoryContext {
  return { now: new Date(Math.floor(Date.now() / 1000) * 1000) };
}

/** `at` moved by `ms` milliseconds, as a new Date. */
export function shiftMs(at: Date, ms: number): Date {
  return new Date(at.getTime() + ms);
}

export const SECOND_MS = 1000;
export const HOUR_MS = 60 * 60 * SECOND_MS;
export const DAY_MS = 24 * HOUR_MS;
