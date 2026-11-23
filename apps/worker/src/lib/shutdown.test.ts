import { createLogger } from '@citizenrun/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKER_STOP_TIMEOUT_MS, createShutdown } from './shutdown.ts';

function capture(order: string[]): ReturnType<typeof createLogger> {
  return createLogger({
    service: 'worker',
    level: 'debug',
    sink: (line) => {
      const parsed = JSON.parse(line) as { event: string }; // the logger writes JSON objects
      order.push(`log:${parsed.event}`);
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('createShutdown', () => {
  it('stops in order', async () => {
    const order: string[] = [];
    const stopOptions: unknown[] = [];
    const abort = new AbortController();
    const shutdown = createShutdown({
      boss: {
        stop: (options) => {
          stopOptions.push(options);
          order.push('boss.stop');
          return Promise.resolve();
        },
      },
      pool: {
        end: () => {
          order.push('pool.end');
          return Promise.resolve();
        },
      },
      abort,
      logger: capture(order),
      exit: (code) => {
        order.push(`exit:${String(code)}`);
      },
    });
    await shutdown.run('SIGTERM');
    expect(order).toEqual([
      'log:worker.stopping',
      'boss.stop',
      'pool.end',
      'log:worker.stopped',
      'exit:0',
    ]);
    expect(stopOptions).toEqual([{ graceful: true, wait: true, timeout: 100_000 }]);
    expect(WORKER_STOP_TIMEOUT_MS).toBe(100_000);
    // The job signals are aborted once the boss has stopped, before the pool closes.
    expect(abort.signal.aborted).toBe(true);
  });

  it('logs the signal it stopped for', async () => {
    const lines: string[] = [];
    const shutdown = createShutdown({
      boss: { stop: () => Promise.resolve() },
      pool: { end: () => Promise.resolve() },
      abort: new AbortController(),
      logger: createLogger({
        service: 'worker',
        level: 'debug',
        sink: (line) => {
          lines.push(line);
        },
      }),
      exit: () => undefined,
    });
    await shutdown.run('SIGINT');
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      event: 'worker.stopping',
      signal: 'SIGINT',
    });
  });

  it('aborts running handlers when the stop outlasts the timeout', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const exit = vi.fn<(code: number) => void>();
    const shutdown = createShutdown({
      boss: {
        stop: () =>
          new Promise<void>((resolve) => {
            setTimeout(resolve, 100_000);
          }),
      },
      pool: { end: () => Promise.resolve() },
      abort,
      logger: capture([]),
      exit,
    });
    const running = shutdown.run('SIGTERM');
    await vi.advanceTimersByTimeAsync(99_999);
    expect(abort.signal.aborted).toBe(false);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(abort.signal.aborted).toBe(true);
    await running;
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('a stop that finishes early aborts nothing before it ends', async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    let abortedDuringStop: boolean | null = null;
    const shutdown = createShutdown({
      boss: {
        stop: () =>
          new Promise<void>((resolve) => {
            setTimeout(() => {
              abortedDuringStop = abort.signal.aborted;
              resolve();
            }, 1_000);
          }),
      },
      pool: { end: () => Promise.resolve() },
      abort,
      logger: capture([]),
      exit: () => undefined,
    });
    const running = shutdown.run('SIGTERM');
    await vi.advanceTimersByTimeAsync(1_000);
    await running;
    expect(abortedDuringStop).toBe(false);
    // The timer was cleared: nothing is left to fire.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a second signal does not stop twice', async () => {
    const stop = vi.fn(() => Promise.resolve());
    const exit = vi.fn<(code: number) => void>();
    const shutdown = createShutdown({
      boss: { stop },
      pool: { end: () => Promise.resolve() },
      abort: new AbortController(),
      logger: capture([]),
      exit,
    });
    const first = shutdown.run('SIGTERM');
    const second = shutdown.run('SIGINT');
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('a failed stop exits 1 with the error class only', async () => {
    const lines: string[] = [];
    const exit = vi.fn<(code: number) => void>();
    const shutdown = createShutdown({
      boss: { stop: () => Promise.reject(new TypeError('connection to host fixture refused')) },
      pool: { end: () => Promise.resolve() },
      abort: new AbortController(),
      logger: createLogger({
        service: 'worker',
        level: 'debug',
        sink: (line) => {
          lines.push(line);
        },
      }),
      exit,
    });
    await shutdown.run('SIGTERM');
    expect(exit).toHaveBeenCalledWith(1);
    expect(JSON.parse(lines.at(-1) ?? '{}')).toMatchObject({
      level: 'error',
      event: 'worker.stop_failed',
      errorClass: 'TypeError',
    });
    expect(lines.join('\n')).not.toContain('fixture refused');
  });
});
