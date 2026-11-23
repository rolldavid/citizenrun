import type { Logger } from '@citizenrun/shared';

const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

/** The event of a crash line: this service's own (D-807). */
export type CrashEvent = 'worker.crashed';

/** What ended the process: an uncaught exception or an unhandled rejection. */
export type CrashSource = 'exception' | 'rejection';

// The error's name when it is an `Error` whose name is an identifier, else `Error`.
function crashClassOf(error: unknown): string {
  return error instanceof Error && ERROR_CLASS_PATTERN.test(error.name) ? error.name : 'Error';
}

/**
 * A handler for an uncaught exception or an unhandled rejection: one `error` line with the error's
 * class and `source` and nothing else, then `exit(1)` (D-807). Node's own crash text is never
 * printed. `event` has one value in this service, which the line names as a literal so that every
 * event is fixed in the source (D-804).
 */
export function processErrorHandler(
  logger: Logger,
  event: CrashEvent,
  source: CrashSource,
  exit: (code: number) => void,
): (error: unknown) => void {
  return (error) => {
    try {
      logger.error('worker.crashed', { errorClass: crashClassOf(error), source });
    } finally {
      exit(1);
    }
  };
}

/** Registers processErrorHandler for `uncaughtException` and `unhandledRejection`. */
export function installProcessErrorHandlers(logger: Logger, event: CrashEvent): void {
  const exit = (code: number): void => {
    process.exit(code);
  };
  process.on('uncaughtException', processErrorHandler(logger, event, 'exception', exit));
  process.on('unhandledRejection', processErrorHandler(logger, event, 'rejection', exit));
}
