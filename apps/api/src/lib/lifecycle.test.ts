import { createLogger } from '@citizenrun/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_HARD_STOP_MS, createLifecycle, drainServer } from './lifecycle.ts';
import type { DrainableServer } from './lifecycle.ts';

function capture(): { raw: string[]; logger: ReturnType<typeof createLogger> } {
  const raw: string[] = [];
  return {
    raw,
    logger: createLogger({
      service: 'api',
      level: 'debug',
      sink: (line) => {
        raw.push(line);
      },
    }),
  };
}

function fakeServer(options: { closes: boolean }): DrainableServer & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    close: (callback) => {
      calls.push('close');
      if (options.closes) {
        setTimeout(() => {
          callback?.();
        }, 10);
      }
    },
    closeIdleConnections: () => {
      calls.push('closeIdleConnections');
    },
    closeAllConnections: () => {
      calls.push('closeAllConnections');
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('lifecycle', () => {
  it('draining starts false and turns on once', () => {
    const lifecycle = createLifecycle();
    expect(lifecycle.isDraining()).toBe(false);
    lifecycle.beginDrain();
    expect(lifecycle.isDraining()).toBe(true);
    lifecycle.beginDrain();
    expect(lifecycle.isDraining()).toBe(true);
    // Each lifecycle has its own state.
    expect(createLifecycle().isDraining()).toBe(false);
  });

  it('drain closes the server and its idle connections', async () => {
    vi.useFakeTimers();
    const log = capture();
    const server = fakeServer({ closes: true });
    let done = false;
    const draining = drainServer(server, { hardStopMs: API_HARD_STOP_MS, logger: log.logger }).then(
      () => {
        done = true;
      },
    );
    expect(server.calls).toEqual(['close', 'closeIdleConnections']);
    await vi.advanceTimersByTimeAsync(10);
    await draining;
    expect(done).toBe(true);
    // The hard stop was cleared: nothing more happens after 25 seconds.
    await vi.advanceTimersByTimeAsync(API_HARD_STOP_MS);
    expect(server.calls).not.toContain('closeAllConnections');
    expect(log.raw).toEqual([]);
  });

  it('the hard stop closes every connection after 25 seconds', async () => {
    vi.useFakeTimers();
    const log = capture();
    const server = fakeServer({ closes: false });
    void drainServer(server, { hardStopMs: API_HARD_STOP_MS, logger: log.logger });
    await vi.advanceTimersByTimeAsync(API_HARD_STOP_MS - 1);
    expect(server.calls).not.toContain('closeAllConnections');
    await vi.advanceTimersByTimeAsync(1);
    expect(server.calls.filter((call) => call === 'closeAllConnections')).toHaveLength(1);
    expect(log.raw).toHaveLength(1);
    expect(JSON.parse(log.raw[0] ?? '{}')).toMatchObject({ level: 'warn', event: 'api.hard_stop' });
    expect(API_HARD_STOP_MS).toBe(25_000);
  });

  it('a drain resolves when the server closes after the hard stop', async () => {
    const hooks: { fire?: () => void; hardStop?: () => void } = {};
    const server: DrainableServer = {
      close: (callback) => {
        hooks.fire = () => {
          callback?.();
        };
      },
    };
    const draining = drainServer(server, {
      hardStopMs: 5,
      logger: capture().logger,
      setTimer: (fn) => {
        hooks.hardStop = fn;
        return 'handle';
      },
      clearTimer: () => undefined,
    });
    hooks.hardStop?.();
    hooks.fire?.();
    await expect(draining).resolves.toBeUndefined();
  });
});
