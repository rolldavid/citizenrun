import { describe, expect, it, vi } from 'vitest';
import { UnexpectedOutboundCall, createFakeOutbound } from './outbound.ts';

describe('createFakeOutbound', () => {
  it('serves a registered route and records the call', async () => {
    const fake = createFakeOutbound();
    fake.on('appleid.apple.com', 'POST', '/auth/revoke', (request) => ({
      status: 200,
      json: { seen: request.body },
    }));
    const response = await fake.fetch('appleid.apple.com', '/auth/revoke', {
      method: 'post',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Fixture': 'one' },
      body: new URLSearchParams({ token: 'fixture-token', token_type_hint: 'refresh_token' }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({
      seen: 'token=fixture-token&token_type_hint=refresh_token',
    });
    expect(fake.calls).toEqual([
      {
        host: 'appleid.apple.com',
        method: 'POST',
        path: '/auth/revoke',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-fixture': 'one' },
        body: 'token=fixture-token&token_type_hint=refresh_token',
      },
    ]);
  });

  it('records a JSON body as its text, a missing body as null and a plain body as written', async () => {
    const fake = createFakeOutbound();
    fake.on('api.resend.com', 'POST', '/emails', () => ({ status: 202, body: 'accepted' }));
    fake.on('api.resend.com', 'GET', '/domains', () => ({ status: 200, headers: { 'x-a': 'b' } }));
    const sent = await fake.fetch('api.resend.com', '/emails', {
      method: 'POST',
      body: JSON.stringify({ subject: 'fixture' }),
    });
    expect(await sent.text()).toBe('accepted');
    const listed = await fake.fetch('api.resend.com', '/domains');
    expect(listed.headers.get('x-a')).toBe('b');
    expect(fake.calls.map((call) => [call.method, call.body])).toEqual([
      ['POST', '{"subject":"fixture"}'],
      ['GET', null],
    ]);
  });

  it('an unregistered call throws and is still recorded', async () => {
    const fake = createFakeOutbound();
    fake.on('appleid.apple.com', 'POST', '/auth/revoke', () => ({ status: 200 }));
    const marker = 'fixture-body-marker';
    const call = fake.fetch('appleid.apple.com', '/auth/token', { method: 'POST', body: marker });
    await expect(call).rejects.toBeInstanceOf(UnexpectedOutboundCall);
    await expect(fake.fetch('appleid.apple.com', '/auth/token', { body: marker })).rejects.toThrow(
      /GET appleid\.apple\.com/,
    );
    const error = await fake.fetch('exp.host', '/', { body: marker }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnexpectedOutboundCall);
    expect(String(error)).not.toContain(marker);
    expect(fake.calls.map((entry) => `${entry.method} ${entry.host}${entry.path}`)).toEqual([
      'POST appleid.apple.com/auth/token',
      'GET appleid.apple.com/auth/token',
      'GET exp.host/',
    ]);
  });

  it('a pattern matches the path without its query', async () => {
    const fake = createFakeOutbound();
    fake.on('store.example.test', 'GET', '/bucket', () => ({ status: 200, body: 'string' }));
    fake.on('store.example.test', 'GET', /^\/other\?list-type=2$/, () => ({
      status: 200,
      body: 'regexp',
    }));
    const first = await fake.fetch('store.example.test', '/bucket?list-type=2&prefix=a%2F');
    expect(await first.text()).toBe('string');
    await expect(fake.fetch('store.example.test', '/bucket/key')).rejects.toBeInstanceOf(
      UnexpectedOutboundCall,
    );
    // A RegExp sees the whole path, query included.
    const second = await fake.fetch('store.example.test', '/other?list-type=2');
    expect(await second.text()).toBe('regexp');
    await expect(fake.fetch('store.example.test', '/other')).rejects.toBeInstanceOf(
      UnexpectedOutboundCall,
    );
    expect(fake.calls[0]?.path).toBe('/bucket?list-type=2&prefix=a%2F');
  });

  it('the first matching route wins', async () => {
    const fake = createFakeOutbound();
    fake.on('appleid.apple.com', 'POST', /^\/auth\//, () => ({ status: 400 }));
    fake.on('appleid.apple.com', 'POST', '/auth/revoke', () => ({ status: 200 }));
    const response = await fake.fetch('appleid.apple.com', '/auth/revoke', { method: 'POST' });
    expect(response.status).toBe(400);
    // Another host or method is another route.
    await expect(
      fake.fetch('api.resend.com', '/auth/revoke', { method: 'POST' }),
    ).rejects.toBeInstanceOf(UnexpectedOutboundCall);
    await expect(fake.fetch('appleid.apple.com', '/auth/revoke')).rejects.toBeInstanceOf(
      UnexpectedOutboundCall,
    );
  });

  it('an aborted signal rejects before the route runs', async () => {
    const fake = createFakeOutbound();
    const handler = vi.fn(() => ({ status: 200 }));
    fake.on('appleid.apple.com', 'POST', '/auth/revoke', handler);
    const controller = new AbortController();
    const reason = new Error('fixture abort');
    controller.abort(reason);
    await expect(
      fake.fetch('appleid.apple.com', '/auth/revoke', {
        method: 'POST',
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(handler).not.toHaveBeenCalled();
  });

  it('reset forgets the routes and the calls', async () => {
    const fake = createFakeOutbound();
    fake.on('appleid.apple.com', 'GET', '/auth/keys', () => ({ status: 200 }));
    await fake.fetch('appleid.apple.com', '/auth/keys');
    expect(fake.calls).toHaveLength(1);
    fake.reset();
    expect(fake.calls).toHaveLength(0);
    await expect(fake.fetch('appleid.apple.com', '/auth/keys')).rejects.toBeInstanceOf(
      UnexpectedOutboundCall,
    );
  });
});
