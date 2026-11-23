import type { JobName, JobPayload } from '@citizenrun/shared';
import type { JobContext } from '../context.ts';

export type QueueOptions = {
  policy: 'standard' | 'singleton' | 'stately';
  retryLimit: 2; // every queue: three attempts in all (D-062, D-238)
  retryDelay: number; // seconds before the first retry
  retryBackoff: true; // D-238
  retryDelayMax: number; // seconds, cap on the backed-off delay
  expireInSeconds: number; // the job's time limit
  heartbeatSeconds: number | null;
  deleteAfterSeconds: 86400; // finished jobs kept 24 hours (R-104, R-061)
  deadLetter: 'ops.dead' | null; // null only for ops.dead itself
};
export type WorkOptions = { localConcurrency: number; pollingIntervalSeconds: number };

export type JobDefinition<N extends JobName> = {
  name: N;
  queue: QueueOptions;
  work: WorkOptions;
  handle(payload: JobPayload<N>, ctx: JobContext): Promise<void>;
};

export type AnyJobDefinition = { [N in JobName]: JobDefinition<N> }[JobName];

/** Thrown by a handler for a failure that can never pass on a retry; the job completes. */
export class PermanentJobError extends Error {
  override readonly name = 'PermanentJobError';

  constructor(message = 'The job can never succeed.') {
    super(message);
  }
}

/** A failure that may pass on a retry; `reason` is a fixed code such as 'shutdown', 'timeout' or 'provider_5xx', never provider text. */
export class RetryableJobError extends Error {
  override readonly name = 'RetryableJobError';
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

/** What the handler wrapper throws to pg-boss: `name` and `message` are both the error class, so no provider or database text is stored (CTL-26). */
export class JobFailedError extends Error {
  constructor(errorClass: string) {
    super(errorClass);
    this.name = errorClass;
  }
}

const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const ERROR_CLASS_MAX_LENGTH = 60;

/** `value` when it is a string of at most 60 characters matching ^[A-Za-z][A-Za-z0-9_]*$, else null. */
export function classNameOrNull(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length <= ERROR_CLASS_MAX_LENGTH &&
    ERROR_CLASS_PATTERN.test(value)
    ? value
    : null;
}

/** The error's `name` when it is a string of at most 60 characters matching ^[A-Za-z][A-Za-z0-9_]*$, else 'Error' (J-ops.dead step 2). */
export function errorClassOf(error: unknown): string {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return 'Error';
  }
  return classNameOrNull(error.name) ?? 'Error';
}
