import type { Clock } from '../clock.ts';

function toMs(at: Date | string): number {
  const ms = new Date(at).getTime();
  if (Number.isNaN(ms)) {
    throw new RangeError('FakeClock needs a valid date');
  }
  return ms;
}

/** A clock that never moves by itself; tests move it with `set` and `advance`. */
export class FakeClock implements Clock {
  #ms: number;

  /** Starts at `start`, or at the real time truncated to the second. */
  constructor(start?: Date | string) {
    this.#ms = start === undefined ? Math.floor(Date.now() / 1000) * 1000 : toMs(start);
  }

  /** The current fake time, as a new Date on each call. */
  now(): Date {
    return new Date(this.#ms);
  }

  /** Moves the clock to `at`. */
  set(at: Date | string): void {
    this.#ms = toMs(at);
  }

  /** Moves the clock forward by `ms` milliseconds (backward when negative). */
  advance(ms: number): void {
    this.#ms += ms;
  }
}
