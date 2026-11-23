import { JOB_PAYLOADS } from '@citizenrun/shared';
import type { JobName, JobPayload } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import { fromDrizzle } from 'pg-boss';
import type { PgBoss, SendOptions } from 'pg-boss';
import type { Tx } from '../client.ts';

export type EnqueueOptions = {
  /** Send inside this transaction, so a rollback cancels the job (D-238). */
  tx?: Tx;
  /** Seconds from now, or an instant. */
  startAfter?: number | Date;
  /** One queued-or-active job per key. */
  singletonKey?: string;
  /** At most one job per key in the window: `boss.sendDebounced`. */
  debounce?: { seconds: number; key: string };
  /** At most one job per key in the window: `boss.sendThrottled`. */
  throttle?: { seconds: number; key: string };
};

export type Enqueue = <N extends JobName>(
  name: N,
  payload: JobPayload<N>,
  options?: EnqueueOptions,
) => Promise<string | null>;

/** Thrown when pg-boss refuses a send because the queue does not exist yet (a deploy that adds a queue). */
export class QueueMissingError extends Error {
  override readonly name = 'QueueMissingError';
  readonly queue: string;

  constructor(queue: string) {
    // The fixed text only: a pg-boss or Postgres message is never copied here.
    super('queue missing');
    this.queue = queue;
  }
}

function sendOptions(options: EnqueueOptions): SendOptions {
  const send: SendOptions = {};
  if (options.startAfter !== undefined) {
    send.startAfter = options.startAfter;
  }
  if (options.singletonKey !== undefined) {
    send.singletonKey = options.singletonKey;
  }
  if (options.tx !== undefined) {
    send.db = fromDrizzle(options.tx, sql);
  }
  return send;
}

// pg-boss stores an object or null as a job's data. Every schema but `ops.dead`'s is an object;
// `ops.dead` carries a copy of a failed job's data, which pg-boss itself wrote as an object or null.
function jobData(parsed: unknown): object | null {
  if (parsed === null || typeof parsed === 'object') {
    return parsed;
  }
  throw new TypeError('a job payload must be an object or null');
}

// True only when pg-boss answers that the queue does not exist; a failed lookup is false, so the
// caller rethrows the send's own error.
async function isQueueMissing(boss: PgBoss, name: string): Promise<boolean> {
  try {
    const queue: unknown = await boss.getQueue(name);
    return queue === null || queue === undefined;
  } catch {
    return false;
  }
}

/**
 * The one send helper over pg-boss, for the API and the worker: parses the payload with its schema
 * (a parse failure throws), sends it, and returns the job id, or null when pg-boss dropped the send
 * as a singleton, debounce or throttle collision. Throws QueueMissingError when the queue does not
 * exist yet.
 */
export function createEnqueue(boss: PgBoss): Enqueue {
  return async (name, payload, options = {}) => {
    if (options.debounce !== undefined && options.throttle !== undefined) {
      throw new TypeError('debounce and throttle are exclusive');
    }
    const data = jobData(JOB_PAYLOADS[name].parse(payload));
    const send = sendOptions(options);
    try {
      if (options.debounce !== undefined) {
        return await boss.sendDebounced(
          name,
          data,
          send,
          options.debounce.seconds,
          options.debounce.key,
        );
      }
      if (options.throttle !== undefined) {
        return await boss.sendThrottled(
          name,
          data,
          send,
          options.throttle.seconds,
          options.throttle.key,
        );
      }
      return await boss.send(name, data, send);
    } catch (error) {
      if (await isQueueMissing(boss, name)) {
        throw new QueueMissingError(name);
      }
      throw error;
    }
  };
}
