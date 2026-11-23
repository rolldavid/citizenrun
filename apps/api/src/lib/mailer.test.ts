import { ApiError, createLogger } from '@citizenrun/shared';
import type { EmailMessage } from '@citizenrun/shared';
import { marker } from '@citizenrun/shared/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testApiEnv } from '../testing/env.ts';
import {
  CAPTURE_KEEP,
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
      service: 'api',
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
    // messages() is a copy.
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
    const env = testApiEnv();
    const mailer = createMailer(env, log.logger);
    for (let index = 1; index <= 3; index += 1) {
      await mailer.sendEmail(message(index, { to: ['a@example.test', 'b@example.test'] }));
    }
    expect(log.raw).toEqual([]);
  });
});

describe('the Resend mailer', () => {
  it('the Resend mailer sends from EMAIL_FROM with the idempotency key', async () => {
    const stub = stubClient(() => Promise.resolve({ data: { id: 'fixture-id' }, error: null }));
    const mailer = createResendMailer({
      apiKey: FIXTURE_KEY,
      from: FIXTURE_FROM,
      logger: capture().logger,
      client: stub.client,
      gate: openGate,
    });
    await mailer.sendEmail(
      message(1, {
        headers: { 'List-Unsubscribe': '<https://app.example.test/u>' },
        replyTo: 'reply@example.test',
      }),
    );
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]?.payload).toEqual({
      from: FIXTURE_FROM,
      to: ['user1@example.test'],
      subject: 'Subject 1',
      text: 'Text 1',
      html: '<p>Text 1</p>',
      headers: { 'List-Unsubscribe': '<https://app.example.test/u>' },
      replyTo: 'reply@example.test',
    });
    expect(stub.calls[0]?.options.idempotencyKey).toBe('job:1');
  });

  it('a provider error becomes unavailable and logs the class only', async () => {
    const value = marker();
    const stub = stubClient(() =>
      Promise.resolve({
        data: null,
        error: { statusCode: 500, name: 'application_error', message: value },
      }),
    );
    const log = capture();
    const mailer = createResendMailer({
      apiKey: FIXTURE_KEY,
      from: FIXTURE_FROM,
      logger: log.logger,
      client: stub.client,
      gate: openGate,
    });
    const failure = await mailer.sendEmail(message(1)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe('unavailable'); // checked to be an ApiError above
    expect(log.raw).toHaveLength(1);
    const line = JSON.parse(log.raw[0] ?? '{}') as Record<string, unknown>; // the logger writes JSON objects
    expect(line).toMatchObject({
      level: 'warn',
      event: 'mailer.failed',
      errorClass: 'application_error',
      status: 500,
    });
    expect(log.raw.join('\n')).not.toContain(value);
    expect(log.raw.join('\n')).not.toContain('example.test');
  });

  it('a thrown error becomes unavailable with a safe class name', async () => {
    const odd = new Error('boom');
    odd.name = 'name with spaces';
    const stub = stubClient(() => Promise.reject(odd));
    const log = capture();
    const mailer = createResendMailer({
      apiKey: FIXTURE_KEY,
      from: FIXTURE_FROM,
      logger: log.logger,
      client: stub.client,
      gate: openGate,
    });
    await expect(mailer.sendEmail(message(1))).rejects.toMatchObject({ code: 'unavailable' });
    expect(JSON.parse(log.raw[0] ?? '{}')).toMatchObject({ errorClass: 'Error', status: null });
  });

  it('a send that never settles times out as unavailable', async () => {
    vi.useFakeTimers();
    const stub = stubClient(() => new Promise<ResendResult>(() => undefined));
    const log = capture();
    const mailer = createResendMailer({
      apiKey: FIXTURE_KEY,
      from: FIXTURE_FROM,
      logger: log.logger,
      client: stub.client,
      gate: openGate,
    });
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
    const failure = await sending;
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe('unavailable'); // checked to be an ApiError above
    expect(JSON.parse(log.raw[0] ?? '{}')).toMatchObject({ event: 'mailer.failed', status: null });
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

  it('the gate lets a send through at once after a quiet second', async () => {
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
    await gate.acquire();
    clock += 1000;
    await gate.acquire();
    expect(slept).toEqual([]);
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
});

describe('createMailer', () => {
  it('createMailer chooses by captureMail', () => {
    const log = capture();
    const captureEnv = testApiEnv();
    expect(captureEnv.captureMail).toBe(true);
    const local = createMailer(captureEnv, log.logger);
    expect('kind' in local && local.kind === 'capture').toBe(true);

    const resendEnv = testApiEnv({ RESEND_API_KEY: FIXTURE_KEY, EMAIL_FROM: FIXTURE_FROM });
    expect(resendEnv.captureMail).toBe(false);
    const resend = createMailer(resendEnv, log.logger);
    expect('kind' in resend).toBe(false);
    expect('messages' in resend).toBe(false);
  });
});
