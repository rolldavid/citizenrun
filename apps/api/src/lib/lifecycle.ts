import type { Logger } from '@citizenrun/shared';

/** The drain state `/readyz` reads (E-WEB-02). */
export type Lifecycle = { isDraining(): boolean; beginDrain(): void };

/** A drain state that starts off and, once turned on, stays on. */
export function createLifecycle(): Lifecycle {
  let draining = false;
  return {
    isDraining: () => draining,
    beginDrain: () => {
      draining = true;
    },
  };
}

/** D-024: the API stops within Railway's 30-second drain. */
export const API_HARD_STOP_MS = 25_000;

/** The part of an HTTP server the drain uses. */
export type DrainableServer = {
  close(callback?: (error?: Error) => void): unknown;
  closeIdleConnections?(): void;
  closeAllConnections?(): void;
};

/**
 * Stops the server taking connections and lets open requests finish, closing idle connections at
 * once. If the server has not closed after `hardStopMs`, every connection is closed and
 * `api.hard_stop` is logged. Resolves when the server has closed.
 */
export function drainServer(
  server: DrainableServer,
  input: {
    hardStopMs: number;
    logger: Logger;
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
  },
): Promise<void> {
  const setTimer = input.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer =
    input.clearTimer ??
    ((handle: unknown): void => {
      clearTimeout(handle as ReturnType<typeof setTimeout>); // the handle came from setTimeout above
    });
  return new Promise((resolve) => {
    const timer = setTimer(() => {
      server.closeAllConnections?.();
      input.logger.warn('api.hard_stop');
    }, input.hardStopMs);
    server.close(() => {
      clearTimer(timer);
      resolve();
    });
    server.closeIdleConnections?.();
  });
}
