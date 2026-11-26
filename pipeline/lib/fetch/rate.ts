// The per-host pace and the per-process ceiling (D-331).
import type { Clock } from './clock.ts';
import { DAILY_CAP, MIN_GAP_MS, readDayCount } from './host-lock.ts';
import type { HostLock } from './host-lock.ts';

export { DAILY_CAP, MIN_GAP_MS };

/** Hosts with a request in flight in one process (D-331). */
export const MAX_HOSTS_IN_FLIGHT = 8;

/** The host has had DAILY_CAP requests today; no request is sent. */
export class DailyCapError extends Error {
  override readonly name = 'DailyCapError';
  readonly host: string;

  constructor(host: string) {
    super('daily_cap');
    this.host = host;
  }
}

export class HostLimiter {
  /** The clock the limiter was built with; the lock times the gap on the same clock. */
  readonly clock: Clock;
  readonly #lock: HostLock;
  #inFlight = 0;
  readonly #waiting: (() => void)[] = [];
  readonly #hostTail = new Map<string, Promise<void>>();

  constructor(clock: Clock, lock: HostLock) {
    this.clock = clock;
    this.#lock = lock;
  }

  /** Waits for the host's turn, then takes its lock; the returned function gives both back. */
  async acquire(host: string, today: string): Promise<() => void> {
    const name = host.toLowerCase();
    const releaseTurn = await this.#hostTurn(name);
    await this.#slot();
    let taken: Awaited<ReturnType<HostLock['take']>>;
    try {
      taken = await this.#lock.take(name, today);
    } catch (error) {
      this.#freeSlot();
      releaseTurn();
      throw error;
    }
    if (taken === 'daily_cap') {
      this.#freeSlot();
      releaseTurn();
      throw new DailyCapError(name);
    }
    const lock = taken;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this.#freeSlot();
      releaseTurn();
      lock.release();
    };
  }

  /** The shared count of requests to `host` on `today`. */
  requestsToday(host: string, today: string): Promise<number> {
    return readDayCount(this.#lock.dir, host, today);
  }

  /** Requests to one host in this process queue here, so they never hold two of the slots. */
  async #hostTurn(host: string): Promise<() => void> {
    const before = this.#hostTail.get(host) ?? Promise.resolve();
    let done: () => void = () => undefined;
    const mine = new Promise<void>((resolve) => {
      done = resolve;
    });
    const tail = before.then(() => mine);
    this.#hostTail.set(host, tail);
    await before;
    return () => {
      done();
      if (this.#hostTail.get(host) === tail) {
        this.#hostTail.delete(host);
      }
    };
  }

  async #slot(): Promise<void> {
    if (this.#inFlight < MAX_HOSTS_IN_FLIGHT) {
      this.#inFlight += 1;
      return;
    }
    await new Promise<void>((resolve) => {
      this.#waiting.push(resolve);
    });
  }

  #freeSlot(): void {
    const next = this.#waiting.shift();
    if (next === undefined) {
      this.#inFlight -= 1;
    } else {
      next();
    }
  }
}
