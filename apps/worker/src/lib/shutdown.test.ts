import { createLogger } from '@citizenrun/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKER_STOP_TIMEOUT_MS, createShutdown, installShutdown } from './shutdown.ts';

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

describe('installShutdown', () => {
  const signals = ['SIGTERM', 'SIGINT'] as const;

  for (const signal of signals) {
    it(`a repeated ${signal} is ignored while the drain runs`, async () => {
      // Listeners the test process already holds are taken off for the case so the emit cannot
      // reach them, and put back afterwards.
      const held = new Map(signals.map((name) => [name, process.listeners(name)] as const));
      for (const [name, listeners] of held) {
        for (const listener of listeners) {
          process.removeListener(name, listener);
        }
      }
      try {
        const order: string[] = [];
        let finishStop: () => void = () => undefined;
        const stop = vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finishStop = resolve;
            }),
        );
        const exit = vi.fn<(code: number) => void>();
        const shutdown = createShutdown({
          boss: { stop },
          pool: { end: () => Promise.resolve() },
          abort: new AbortController(),
          logger: capture(order),
          exit,
        });
        const run = vi.spyOn(shutdown, 'run');
        installShutdown(shutdown);

        const before = process.listenerCount(signal);
        expect(before).toBe(1);
        // process.emit calls the listeners and sends no real signal.
        process.emit(signal, signal);
        // Still registered: a real repeat reaches the handler, not Node's default action.
        expect(process.listenerCount(signal)).toBe(before);
        process.emit(signal, signal);

        expect(run).toHaveBeenCalledTimes(2);
        expect(run).toHaveBeenNthCalledWith(1, signal);
        expect(run).toHaveBeenNthCalledWith(2, signal);
        expect(stop).toHaveBeenCalledTimes(1);
        expect(exit).not.toHaveBeenCalled();

        finishStop();
        await shutdown.run(signal); // the first call's promise: the drain itself
        expect(exit).toHaveBeenCalledTimes(1);
        expect(exit).toHaveBeenCalledWith(0);
        expect(order.filter((entry) => entry === 'log:worker.stopping')).toHaveLength(1);
        expect(order.filter((entry) => entry === 'log:worker.stopped')).toHaveLength(1);
      } finally {
        for (const [name, listeners] of held) {
          for (const listener of process.listeners(name)) {
            if (!listeners.includes(listener)) {
              process.removeListener(name, listener);
            }
          }
          for (const listener of listeners) {
            if (!process.listeners(name).includes(listener)) {
              process.on(name, listener);
            }
          }
        }
      }
    });
  }
});
