import { createLogger } from '@citizenrun/shared';
import type { EmailMessage } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PermanentJobError, RetryableJobError } from '../jobs/types.ts';
import { testWorkerEnv } from '../testing/env.ts';
import {
  CAPTURE_KEEP,
  RESEND_BASE_URL,
  createCaptureMailer,
  createMailer,
  createRateGate,
  createResendMailer,
} from './mailer.ts';
import type { ResendClient, ResendPayload, ResendResult } from './mailer.ts';

const FIXTURE_KEY = 're_fixture_0000000000';
const FIXTURE_FROM = 'Fixture <alerts@mail.example.test>';

function message(index: number, extra: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: `user${String(index)}@example.test`,
    subject: `Subject ${String(index)}`,
    text: `Text ${String(index)}`,
    html: `<p>Text ${String(index)}</p>`,
    idempotencyKey: `job:${String(index)}`,
    ...extra,
  };
}

function capture(): { raw: string[]; logger: ReturnType<typeof createLogger> } {
  const raw: string[] = [];
  return {
    raw,
    logger: createLogger({
      service: 'worker',
      level: 'debug',
      sink: (line) => {
        raw.push(line);
      },
    }),
  };
}

const openGate = { acquire: (): Promise<void> => Promise.resolve() };

function stubClient(answer: () => Promise<ResendResult>): {
  client: ResendClient;
  calls: { payload: ResendPayload; options: { idempotencyKey: string } }[];
} {
  const calls: { payload: ResendPayload; options: { idempotencyKey: string } }[] = [];
  return {
    calls,
    client: {
      emails: {
        send: (payload, options) => {
          calls.push({ payload, options });
          return answer();
        },
      },
    },
  };
}

function resendMailer(
  answer: () => Promise<ResendResult>,
  logger = capture().logger,
): {
  mailer: ReturnType<typeof createResendMailer>;
  calls: ReturnType<typeof stubClient>['calls'];
} {
  const stub = stubClient(answer);
  return {
    calls: stub.calls,
    mailer: createResendMailer({
      apiKey: FIXTURE_KEY,
      from: FIXTURE_FROM,
      logger,
      client: stub.client,
      gate: openGate,
    }),
  };
}

function providerError(statusCode: number | null, text = 'provider text'): ResendResult {
  return { data: null, error: { statusCode, name: 'application_error', message: text } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the capture mailer', () => {
  it('the capture mailer keeps the newest 50', async () => {
    const mailer = createCaptureMailer();
    for (let index = 1; index <= CAPTURE_KEEP + 1; index += 1) {
      await mailer.sendEmail(message(index));
    }
    const held = mailer.messages();
    expect(held).toHaveLength(50);
    expect(held[0]?.idempotencyKey).toBe('job:2');
    expect(held.at(-1)).toEqual({
      to: ['user51@example.test'],
      subject: 'Subject 51',
      text: 'Text 51',
      html: '<p>Text 51</p>',
      headers: {},
      idempotencyKey: 'job:51',
      replyTo: null,
    });
    expect(held.some((item) => item.idempotencyKey === 'job:1')).toBe(false);
    expect(mailer.messages()).not.toBe(held);
    expect(mailer.messages()).toEqual(held);
  });

  it('a repeated idempotency key is held once', async () => {
    const mailer = createCaptureMailer();
    await mailer.sendEmail(message(1));
    await mailer.sendEmail(message(2, { idempotencyKey: 'job:1', subject: 'Again' }));
    expect(mailer.messages().map((item) => item.subject)).toEqual(['Subject 1']);
  });

  it('a key that fell out of the held messages is still remembered', async () => {
    const mailer = createCaptureMailer(2);
    for (let index = 1; index <= 3; index += 1) {
      await mailer.sendEmail(message(index));
    }
    await mailer.sendEmail(message(4, { idempotencyKey: 'job:1' }));
    expect(mailer.messages().map((item) => item.idempotencyKey)).toEqual(['job:2', 'job:3']);
  });

  it('the capture mailer writes no log line', async () => {
    const log = capture();
    const mailer = createMailer(testWorkerEnv(), log.logger);
    for (let index = 1; index <= 3; index += 1) {
      await mailer.sendEmail(message(index, { to: ['a@example.test', 'b@example.test'] }));
    }
    expect('kind' in mailer && mailer.kind === 'capture').toBe(true);
    expect(log.raw).toEqual([]);
  });
});

describe('the Resend mailer', () => {
  it('sends from EMAIL_FROM with the message and its headers', async () => {
    const { mailer, calls } = resendMailer(() =>
      Promise.resolve({ data: { id: 'fixture-id' }, error: null }),
    );
    await mailer.sendEmail(
      message(1, { to: ['a@example.test', 'b@example.test'], replyTo: 'reply@example.test' }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.payload).toEqual({
      from: FIXTURE_FROM,
      to: ['a@example.test', 'b@example.test'],
      subject: 'Subject 1',
      text: 'Text 1',
      html: '<p>Text 1</p>',
      replyTo: 'reply@example.test',
    });
  });

  it('the job id is the idempotency key', async () => {
    const jobId = '0195d2c4-0000-7000-8000-000000000001';
    const { mailer, calls } = resendMailer(() =>
      Promise.resolve({ data: { id: 'fixture-id' }, error: null }),
    );
    await mailer.sendEmail(message(1, { idempotencyKey: `job:${jobId}` }));
    expect(calls[0]?.options.idempotencyKey).toBe(`job:${jobId}`);
  });

  it('429, 5xx, network errors and the timeout are retryable', async () => {
    const answers: (() => Promise<ResendResult>)[] = [
      () => Promise.resolve(providerError(429)),
      () => Promise.resolve(providerError(500)),
      () => Promise.resolve(providerError(503)),
      // The SDK reports a request that could not be made with no status.
      () => Promise.resolve(providerError(null)),
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.reject(Object.assign(new Error('bad gateway'), { statusCode: 502 })),
    ];
    for (const answer of answers) {
      const { mailer } = resendMailer(answer);
      const failure = await mailer.sendEmail(message(1)).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(RetryableJobError);
      expect((failure as RetryableJobError).reason).toBe('provider_unavailable'); // checked above
    }

    vi.useFakeTimers();
    const log = capture();
    const { mailer } = resendMailer(() => new Promise<ResendResult>(() => undefined), log.logger);
    let settled: unknown = 'pending';
    const sending = mailer.sendEmail(message(1)).then(
      () => 'sent',
      (error: unknown) => error,
    );
    void sending.then((value) => {
      settled = value;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe('pending');
    await vi.advanceTimersByTimeAsync(1);
    expect(await sending).toBeInstanceOf(RetryableJobError);
    expect(JSON.parse(log.raw[0] ?? '{}')).toMatchObject({
      event: 'mailer.failed',
      errorClass: 'ResendTimeoutError',
      status: null,
    });
  });

  it('another 4xx is permanent', async () => {
    for (const status of [400, 403, 422]) {
      const { mailer } = resendMailer(() => Promise.resolve(providerError(status)));
      const failure = await mailer.sendEmail(message(1)).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(PermanentJobError);
      expect((failure as PermanentJobError).message).toBe(
        'The email provider refused the message.',
      ); // checked to be a PermanentJobError above
    }
    const { mailer } = resendMailer(() =>
      Promise.reject(Object.assign(new Error('refused'), { statusCode: 422 })),
    );
    await expect(mailer.sendEmail(message(1))).rejects.toBeInstanceOf(PermanentJobError);
  });

  it('provider text is never logged', async () => {
    const value = marker();
    for (const answer of [
      () => Promise.resolve(providerError(500, value)),
      () => Promise.resolve(providerError(422, value)),
      () => Promise.reject(new Error(value)),
    ]) {
      const log = capture();
      const { mailer } = resendMailer(answer, log.logger);
      const failure = await mailer.sendEmail(message(1)).catch((error: unknown) => error);
      expect(String(failure)).not.toContain(value);
      expect(log.raw).toHaveLength(1);
      const line = JSON.parse(log.raw[0] ?? '{}') as Record<string, unknown>; // the logger writes JSON objects
      expect(line).toMatchObject({ level: 'warn', event: 'mailer.failed' });
      expect(Object.keys(line).sort()).toEqual(
        ['time', 'level', 'service', 'event', 'errorClass', 'status'].sort(),
      );
      expect(log.raw.join('\n')).not.toContain(value);
      expect(log.raw.join('\n')).not.toContain('example.test');
    }
  });

  it('a provider error logs its class and status', async () => {
    const log = capture();
    const { mailer } = resendMailer(() => Promise.resolve(providerError(500)), log.logger);
    await mailer.sendEmail(message(1)).catch(() => undefined);
    expect(JSON.parse(log.raw[0] ?? '{}')).toMatchObject({
      errorClass: 'application_error',
      status: 500,
    });
  });

  it('the gate spaces sends 100 ms apart', async () => {
    let clock = 0;
    const slept: number[] = [];
    const gate = createRateGate(10, {
      now: () => clock,
      sleep: (ms) => {
        slept.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    });
    for (let index = 0; index < 11; index += 1) {
      await gate.acquire();
    }
    expect(slept.reduce((sum, ms) => sum + ms, 0)).toBe(1000);
    expect(slept.every((ms) => ms === 100)).toBe(true);
  });

  it('every send waits for the gate', async () => {
    const order: string[] = [];
    const stub = stubClient(() => {
      order.push('send');
      return Promise.resolve({ data: { id: 'fixture-id' }, error: null });
    });
    const mailer = createResendMailer({
      apiKey: FIXTURE_KEY,
      from: FIXTURE_FROM,
      logger: capture().logger,
      client: stub.client,
      gate: {
        acquire: () => {
          order.push('gate');
          return Promise.resolve();
        },
      },
    });
    await mailer.sendEmail(message(1));
    expect(order).toEqual(['gate', 'send']);
  });

  it('calls the one Resend host', () => {
    expect(new URL(RESEND_BASE_URL).host).toBe('api.resend.com');
  });
});

describe('createMailer', () => {
  it('createMailer chooses by captureMail', () => {
    const log = capture();
    const captureEnv = testWorkerEnv();
    expect(captureEnv.captureMail).toBe(true);
    const local = createMailer(captureEnv, log.logger);
    expect('kind' in local && local.kind === 'capture').toBe(true);

    const resendEnv = testWorkerEnv({ RESEND_API_KEY: FIXTURE_KEY, EMAIL_FROM: FIXTURE_FROM });
    expect(resendEnv.captureMail).toBe(false);
    const resend = createMailer(resendEnv, log.logger);
    expect('kind' in resend).toBe(false);
    expect('messages' in resend).toBe(false);
  });
});
