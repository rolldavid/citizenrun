import { setTimeout as sleepFor } from 'node:timers/promises';
import { ApiError, BRAND } from '@citizenrun/shared';
import type { EmailMessage, Logger, Mailer } from '@citizenrun/shared';
import { Resend } from 'resend';
import type { ApiEnv } from '../env.ts';

/** The one Resend host the API calls (CTL-37). */
export const RESEND_BASE_URL = 'https://api.resend.com';
/** Messages the capture mailer holds (D-452). */
export const CAPTURE_KEEP = 50;
/** Every Resend call settles or is abandoned within this time (CTL-37). */
export const RESEND_TIMEOUT_MS = 10_000;
/** Sends started per second in one process (D-246). */
export const RESEND_PER_SECOND = 10;
// How many idempotency keys the capture mailer remembers, as Resend refuses a repeated key (D-452).
const CAPTURE_SEEN_KEYS = 1000;
// CTL-37: `<slug>-api/<version>`.
const USER_AGENT = `${BRAND.slug}-api/0.0.0`;

const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

/** One message as the capture mailer holds it; `to` is always an array. */
export type CapturedEmail = {
  to: readonly string[];
  subject: string;
  text: string;
  html: string;
  headers: Readonly<Record<string, string>>;
  idempotencyKey: string;
  replyTo: string | null;
};

/** The development mode of OI-resend: messages are held in memory, never sent and never logged. */
export type CaptureMailer = Mailer & {
  readonly kind: 'capture';
  messages(): readonly CapturedEmail[];
};

/** The request body the Resend mailer hands the SDK. */
export type ResendPayload = {
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
  replyTo?: string;
};

/** What the SDK answers: most failures come back as `error`, not as a throw. */
export type ResendResult = {
  data: unknown;
  error: { name: string; statusCode: number | null; message: string } | null;
};

/** The part of the Resend SDK the mailer uses; tests pass a stub. */
export type ResendClient = {
  emails: {
    send(
      payload: ResendPayload,
      options: { idempotencyKey: string; signal?: AbortSignal },
    ): Promise<ResendResult>;
  };
};

/** Spaces the starts of sends in one process. */
export type RateGate = { acquire(): Promise<void> };

/** A copy of `message` as the capture mailer holds it. */
export function toCapturedEmail(message: EmailMessage): CapturedEmail {
  return {
    to: Object.freeze(Array.isArray(message.to) ? [...message.to] : [message.to]),
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: Object.freeze({ ...(message.headers ?? {}) }),
    idempotencyKey: message.idempotencyKey,
    replyTo: message.replyTo ?? null,
  };
}

/**
 * The capture mailer's store: the newest `keep` messages, oldest first, where a message whose
 * idempotency key is held or among the last 1,000 seen is not added again. `add` returns whether it
 * was added. Shared with the test fake, so both de-duplicate alike.
 */
export function createCaptureStore(keep: number = CAPTURE_KEEP): {
  readonly list: CapturedEmail[];
  add(message: EmailMessage): boolean;
} {
  const list: CapturedEmail[] = [];
  const seen = new Set<string>();
  const seenOrder: string[] = [];
  return {
    list,
    add: (message) => {
      if (seen.has(message.idempotencyKey)) {
        return false;
      }
      seen.add(message.idempotencyKey);
      seenOrder.push(message.idempotencyKey);
      if (seenOrder.length > CAPTURE_SEEN_KEYS) {
        const oldest = seenOrder.shift();
        if (oldest !== undefined) {
          seen.delete(oldest);
        }
      }
      list.push(toCapturedEmail(message));
      if (list.length > keep) {
        list.splice(0, list.length - keep);
      }
      return true;
    },
  };
}

/** The capture mailer (L-send-email): holds the newest `keep` messages and writes no log line. */
export function createCaptureMailer(keep: number = CAPTURE_KEEP): CaptureMailer {
  const store = createCaptureStore(keep);
  return {
    kind: 'capture',
    sendEmail: (message) => {
      store.add(message);
      return Promise.resolve();
    },
    messages: () => [...store.list],
  };
}

/**
 * A gate that starts acquisitions at least `1000 / perSecond` milliseconds apart. Time is
 * `performance.now()` unless `now` is given; durations are its only use of a clock.
 */
export function createRateGate(
  perSecond: number,
  deps: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): RateGate {
  const intervalMs = 1000 / perSecond;
  const now = deps.now ?? (() => performance.now());
  const sleep =
    deps.sleep ??
    (async (ms: number): Promise<void> => {
      await sleepFor(ms);
    });
  let nextStart = Number.NEGATIVE_INFINITY;
  return {
    acquire: async () => {
      const at = now();
      const start = Math.max(at, nextStart);
      nextStart = start + intervalMs;
      if (start > at) {
        await sleep(start - at);
      }
    },
  };
}

class ResendTimeoutError extends Error {
  override readonly name = 'ResendTimeoutError';

  constructor() {
    super('The provider did not answer in time.');
  }
}

function errorClassOf(name: unknown): string {
  return typeof name === 'string' && ERROR_CLASS_PATTERN.test(name) ? name : 'Error';
}

function payloadOf(from: string, message: EmailMessage): ResendPayload {
  const payload: ResendPayload = {
    from,
    to: Array.isArray(message.to) ? [...message.to] : [message.to],
    subject: message.subject,
    text: message.text,
    html: message.html,
  };
  if (message.headers !== undefined) {
    payload.headers = { ...message.headers };
  }
  if (message.replyTo !== undefined) {
    payload.replyTo = message.replyTo;
  }
  return payload;
}

function sdkClient(apiKey: string): ResendClient {
  const resend = new Resend(apiKey, { baseUrl: RESEND_BASE_URL, userAgent: USER_AGENT });
  return {
    emails: {
      send: (payload, options) => resend.emails.send(payload, options),
    },
  };
}

/**
 * The Resend mailer (L-send-email): From `from`, the message's idempotency key as
 * `Idempotency-Key`, at most RESEND_PER_SECOND starts a second. A provider error, a throw or no
 * answer within the timeout logs `mailer.failed` with the error class and status only and
 * throws ApiError `unavailable`.
 */
export function createResendMailer(input: {
  apiKey: string;
  from: string;
  logger: Logger;
  client?: ResendClient;
  gate?: RateGate;
  timeoutMs?: number;
}): Mailer {
  const client = input.client ?? sdkClient(input.apiKey);
  const gate = input.gate ?? createRateGate(RESEND_PER_SECOND);
  const timeoutMs = input.timeoutMs ?? RESEND_TIMEOUT_MS;
  const fail = (errorClass: string, status: number | null): never => {
    input.logger.warn('mailer.failed', { errorClass, status });
    throw new ApiError('unavailable');
  };

  return {
    sendEmail: async (message) => {
      await gate.acquire();
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ResendTimeoutError());
        }, timeoutMs);
      });
      let result: ResendResult;
      try {
        result = await Promise.race([
          client.emails.send(payloadOf(input.from, message), {
            idempotencyKey: message.idempotencyKey,
            signal: controller.signal,
          }),
          timedOut,
        ]);
      } catch (error) {
        return fail(errorClassOf(error instanceof Error ? error.name : null), null);
      } finally {
        clearTimeout(timer);
      }
      if (result.error !== null) {
        return fail(errorClassOf(result.error.name), result.error.statusCode);
      }
    },
  };
}

/** The API's mailer: the capture mailer while `captureMail`, otherwise Resend. */
export function createMailer(env: ApiEnv, logger: Logger): Mailer {
  if (env.captureMail) {
    return createCaptureMailer();
  }
  if (env.RESEND_API_KEY === null || env.EMAIL_FROM === null) {
    // loadEnv never returns this: outside local and ci both are required, and they come as a pair.
    throw new Error('The Resend mailer needs RESEND_API_KEY and EMAIL_FROM.');
  }
  return createResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM, logger });
}
