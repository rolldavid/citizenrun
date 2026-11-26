import { BRAND } from '@citizenrun/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testApiEnv } from '../testing/env.ts';
import { RESEND_BASE_URL } from './mailer.ts';
import {
  OUTBOUND_HOSTS,
  OUTBOUND_TIMEOUT_MS,
  OutboundHostNotAllowedError,
  allowedHosts,
  createOutboundFetch,
} from './outbound-fetch.ts';

type FetchImpl = NonNullable<Parameters<typeof createOutboundFetch>[1]>;

function spyFetch(): ReturnType<typeof vi.fn<FetchImpl>> {
  return vi.fn<FetchImpl>(() => Promise.resolve(new Response('ok')));
}

const STORE_ENV = {
  MEDIA_BUCKET: 'media-fixture',
  MEDIA_ENDPOINT: 'https://media-store.example.test',
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('outboundFetch', () => {
  it('a host outside the list throws before any socket opens', async () => {
    const spy = spyFetch();
    const outbound = createOutboundFetch(testApiEnv(STORE_ENV), spy);
    for (const host of [
      'evil.example.test',
      'appleid.apple.com.evil.example.test',
      'accounts.google.com',
      'exp.host',
      '',
    ]) {
      await expect(outbound(host, '/auth/keys')).rejects.toBeInstanceOf(
        OutboundHostNotAllowedError,
      );
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it('the sign-in hosts are allowed', async () => {
    expect(OUTBOUND_HOSTS.apple).toBe('appleid.apple.com');
    expect(OUTBOUND_HOSTS.google).toBe('www.googleapis.com');
    expect(OUTBOUND_TIMEOUT_MS.apple).toBe(5_000);
    expect(OUTBOUND_TIMEOUT_MS.google).toBe(5_000);
    const timeouts: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      timeouts.push(ms);
      return real(ms);
    });
    const spy = spyFetch();
    const outbound = createOutboundFetch(testApiEnv(STORE_ENV), spy);
    await outbound('appleid.apple.com', '/auth/keys');
    await outbound('www.googleapis.com', '/oauth2/v3/certs');
    await outbound('api.resend.com', '/emails');
    await outbound('media-store.example.test', '/media-fixture/avatars/x.webp');
    expect(spy.mock.calls.map((call) => call[0])).toEqual([
      'https://appleid.apple.com/auth/keys',
      'https://www.googleapis.com/oauth2/v3/certs',
      'https://api.resend.com/emails',
      'https://media-store.example.test/media-fixture/avatars/x.webp',
    ]);
    expect(timeouts).toEqual([5_000, 5_000, 10_000, 30_000]);
    expect(new Headers(spy.mock.calls[0]?.[1]?.headers).get('user-agent')).toBe(
      `${BRAND.slug}-api/0.0.0`,
    );
  });

  it("every SDK wrapper's base URL host is in the list", () => {
    for (const forcePathStyle of [true, false]) {
      const env = testApiEnv({ ...STORE_ENV, S3_FORCE_PATH_STYLE: String(forcePathStyle) });
      const hosts = allowedHosts(env);
      expect(hosts.has(new URL(RESEND_BASE_URL).host)).toBe(true);
      const mediaHost = forcePathStyle
        ? 'media-store.example.test'
        : 'media-fixture.media-store.example.test';
      expect([...hosts].sort()).toEqual(
        [
          'api.resend.com',
          'appleid.apple.com',
          'www.googleapis.com',
          'geocoding.geo.census.gov',
          'api.geoapify.com',
          mediaHost,
        ].sort(),
      );
    }
  });

  it('the geocoding hosts are allowed', async () => {
    expect(OUTBOUND_HOSTS.census).toBe('geocoding.geo.census.gov');
    expect(OUTBOUND_HOSTS.geoapify).toBe('api.geoapify.com');
    expect(OUTBOUND_TIMEOUT_MS.census).toBe(5_000);
    expect(OUTBOUND_TIMEOUT_MS.geoapify).toBe(2_000);
    const timeouts: number[] = [];
    const real = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      timeouts.push(ms);
      return real(ms);
    });
    const spy = spyFetch();
    const outbound = createOutboundFetch(testApiEnv(STORE_ENV), spy);
    await outbound('geocoding.geo.census.gov', '/geocoder/geographies/onelineaddress?format=json');
    await outbound('api.geoapify.com', '/v1/geocode/autocomplete?format=json', {
      headers: { cookie: 'os_session=fixture-token', 'x-real-ip': '203.0.113.10' },
    });
    expect(spy.mock.calls.map((call) => call[0])).toEqual([
      'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?format=json',
      'https://api.geoapify.com/v1/geocode/autocomplete?format=json',
    ]);
    expect(timeouts).toEqual([5_000, 2_000]);
    for (const call of spy.mock.calls) {
      expect([...new Headers(call[1]?.headers).keys()]).toEqual(['user-agent']);
      expect(call[1]?.redirect).toBe('error');
    }
    // A host that only looks like one of them is still refused.
    await expect(
      outbound('api.geoapify.com.evil.example.test', '/v1/geocode/autocomplete'),
    ).rejects.toBeInstanceOf(OutboundHostNotAllowedError);
    await expect(outbound('geocoding.geo.census.gov.example.test', '/')).rejects.toBeInstanceOf(
      OutboundHostNotAllowedError,
    );
  });

  it('no client header is forwarded', async () => {
    const spy = spyFetch();
    const outbound = createOutboundFetch(testApiEnv(STORE_ENV), spy);
    await outbound('appleid.apple.com', '/auth/token', {
      method: 'POST',
      headers: {
        cookie: '__Host-os_session=fixture-token',
        authorization: 'Bearer fixture-token',
        'x-real-ip': '203.0.113.10',
        'x-os-client': 'web/1.4.0',
        origin: 'https://app.example.test',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=authorization_code',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const headers = new Headers(spy.mock.calls[0]?.[1]?.headers);
    expect(headers.has('cookie')).toBe(false);
    expect(headers.has('authorization')).toBe(false);
    expect([...headers.keys()].sort()).toEqual(['content-type', 'user-agent']);
  });

  it('a redirect is never followed', async () => {
    const spy = spyFetch();
    const outbound = createOutboundFetch(testApiEnv(STORE_ENV), spy);
    await outbound('appleid.apple.com', '/auth/token', { method: 'POST', redirect: 'follow' });
    await outbound('www.googleapis.com', '/oauth2/v3/certs', { redirect: 'manual' });
    await outbound('appleid.apple.com', '/auth/keys');
    expect(spy).toHaveBeenCalledTimes(3);
    for (const call of spy.mock.calls) {
      expect(call[1]?.redirect).toBe('error');
    }
    expect(spy.mock.calls[0]?.[1]?.method).toBe('POST');
  });

  it("a caller's signal still aborts the request", async () => {
    const spy = spyFetch();
    const outbound = createOutboundFetch(testApiEnv(STORE_ENV), spy);
    const controller = new AbortController();
    await outbound('www.googleapis.com', '/oauth2/v3/certs', { signal: controller.signal });
    const signal = spy.mock.calls[0]?.[1]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it('a path must start with a slash', async () => {
    const spy = spyFetch();
    const outbound = createOutboundFetch(testApiEnv(STORE_ENV), spy);
    await expect(outbound('appleid.apple.com', 'auth/keys')).rejects.toBeInstanceOf(TypeError);
    await expect(outbound('appleid.apple.com', '@evil.example.test/x')).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
