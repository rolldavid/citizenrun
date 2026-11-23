import type { Logger } from '@citizenrun/shared';
import { errorClassOf } from '../jobs/types.ts';

/** D-024: running handlers get this long inside Railway's 120-second drain. */
export const WORKER_STOP_TIMEOUT_MS = 100_000;

export type ShutdownDeps = {
  boss: { stop(options: { graceful: boolean; wait: boolean; timeout: number }): Promise<void> };
  pool: { end(): Promise<void> };
  abort: AbortController;
  logger: Logger;
  exit(code: number): void;
  stopTimeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

type ShutdownSignal = 'SIGTERM' | 'SIGINT';

/**
 * The worker's drain (D-024): stop fetching and give running handlers `stopTimeoutMs`, abort every
 * job signal when that time is up (an aborted handler throws RetryableJobError('shutdown') and its
 * job is retried), close the app pool and exit 0. A second call returns the first call's promise.
 */
export function createShutdown(deps: ShutdownDeps): { run(signal: ShutdownSignal): Promise<void> } {
  const stopTimeoutMs = deps.stopTimeoutMs ?? WORKER_STOP_TIMEOUT_MS;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer =
    deps.clearTimer ??
    ((handle: unknown): void => {
      clearTimeout(handle as ReturnType<typeof setTimeout>); // the default setTimer made it
    });
  let running: Promise<void> | null = null;

  const stop = async (signal: ShutdownSignal): Promise<void> => {
    deps.logger.info('worker.stopping', { signal });
    const timer = setTimer(() => {
      deps.abort.abort();
    }, stopTimeoutMs);
    try {
      await deps.boss.stop({ graceful: true, wait: true, timeout: stopTimeoutMs });
    } finally {
      clearTimer(timer);
    }
    if (!deps.abort.signal.aborted) {
      deps.abort.abort();
    }
    await deps.pool.end();
    deps.logger.info('worker.stopped');
    deps.exit(0);
  };

  return {
    run: (signal) => {
      running ??= stop(signal).catch((error: unknown) => {
        // The class only: a driver's message can name a host or a user.
        deps.logger.error('worker.stop_failed', { errorClass: errorClassOf(error) });
        deps.exit(1);
      });
      return running;
    },
  };
}

/**
 * Passes every SIGTERM and SIGINT to `shutdown.run`. The listeners stay registered, so a repeated
 * signal (a watcher that relays Ctrl-C a second time, say) is ignored while the drain runs instead
 * of taking Node's default action and ending the process mid-drain: `run` returns the first call's
 * promise.
 */
export function installShutdown(shutdown: { run(signal: ShutdownSignal): Promise<void> }): void {
  process.on('SIGTERM', () => {
    void shutdown.run('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown.run('SIGINT');
  });
}
