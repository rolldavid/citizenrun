import { BRAND } from '@citizenrun/shared';
import { describe, expect, it, vi } from 'vitest';
import { testWorkerEnv } from '../testing/env.ts';
import { RESEND_BASE_URL } from './mailer.ts';
import {
  OUTBOUND_HOSTS,
  OutboundHostNotAllowedError,
  allowedHosts,
  createOutboundFetch,
} from './outbound-fetch.ts';
import { bucketHost } from './storage.ts';

type FetchImpl = NonNullable<Parameters<typeof createOutboundFetch>[1]>;

function spyFetch(): ReturnType<typeof vi.fn<FetchImpl>> {
  return vi.fn<FetchImpl>(() => Promise.resolve(new Response('ok')));
}

const STORE_ENV = {
  BACKUPS_BUCKET: 'backups-fixture',
  BACKUPS_ENDPOINT: 'https://store.example.test',
};

describe('outboundFetch', () => {
  it('a host outside the list throws before any socket opens', async () => {
    const spy = spyFetch();
    const outbound = createOutboundFetch(testWorkerEnv(STORE_ENV), spy);
    for (const host of ['evil.example.test', 'api.resend.com.evil.example.test', 'exp.host', '']) {
      await expect(outbound(host, '/emails')).rejects.toBeInstanceOf(OutboundHostNotAllowedError);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('every SDK wrapper base URL host is in the list', () => {
    expect(new URL(RESEND_BASE_URL).host).toBe(OUTBOUND_HOSTS.resend);
    for (const forcePathStyle of [true, false]) {
      const env = testWorkerEnv({ ...STORE_ENV, S3_FORCE_PATH_STYLE: String(forcePathStyle) });
      const hosts = allowedHosts(env);
      expect(hosts.has(new URL(RESEND_BASE_URL).host)).toBe(true);
      const host = bucketHost({
        bucket: env.BACKUPS_BUCKET,
        endpoint: env.BACKUPS_ENDPOINT,
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      });
      expect(host).toBe(
        forcePathStyle ? 'store.example.test' : 'backups-fixture.store.example.test',
      );
      expect(hosts.has(host)).toBe(true);
      expect(hosts.size).toBe(2);
    }
  });

  it('requests carry the service user agent and a timeout', async () => {
    const spy = spyFetch();
    const outbound = createOutboundFetch(testWorkerEnv(STORE_ENV), spy);
    const response = await outbound('api.resend.com', '/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(await response.text()).toBe('ok');
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe('https://api.resend.com/emails');
    const headers = new Headers(init?.headers);
    expect(headers.get('user-agent')).toBe(`${BRAND.slug}-worker/0.0.0`);
    expect(headers.get('user-agent')).toBe('citizenrun-worker/0.0.0');
    // Only the header it was given, beside the user agent.
    expect([...headers.keys()].sort()).toEqual(['content-type', 'user-agent']);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.method).toBe('POST');
  });

  it('each host gets its own timeout', async () => {
    const timeouts: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      timeouts.push(ms);
      return real(ms);
    });
    const outbound = createOutboundFetch(testWorkerEnv(STORE_ENV), spyFetch());
    await outbound('api.resend.com', '/emails');
    await outbound('store.example.test', '/backups-fixture?list-type=2');
    expect(timeouts).toEqual([10_000, 30_000]);
  });

  it('a caller signal still aborts the request', async () => {
    const spy = spyFetch();
    const outbound = createOutboundFetch(testWorkerEnv(STORE_ENV), spy);
    const controller = new AbortController();
    await outbound('api.resend.com', '/emails', { signal: controller.signal });
    const signal = spy.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it('a path must start with a slash', async () => {
    const spy = spyFetch();
    const outbound = createOutboundFetch(testWorkerEnv(STORE_ENV), spy);
    await expect(outbound('api.resend.com', 'emails')).rejects.toBeInstanceOf(TypeError);
    await expect(outbound('api.resend.com', '@evil.example.test/emails')).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
