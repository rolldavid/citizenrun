import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';

import { changeHandle, updateProfile } from './profile-requests';

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([]);
  configureTestApiClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('profile requests', () => {
  it('patches only the keys given', async () => {
    const me = fixtureMe({ bio: null });
    stub.use([{ method: 'PATCH', path: '/v1/me', reply: json(200, me) }]);

    const outcome = await updateProfile({ bio: null });

    expect(outcome).toEqual({ ok: true, value: me });
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]).toMatchObject({ method: 'PATCH', path: '/v1/me', query: {} });
    expect(stub.requests[0]?.body).toStrictEqual({ bio: null });
  });

  it('removes the avatar with null', async () => {
    stub.use([{ method: 'PATCH', path: '/v1/me', reply: json(200, fixtureMe()) }]);

    await updateProfile({ avatarUploadKey: null });

    expect(stub.requests.map((request) => request.body)).toStrictEqual([{ avatarUploadKey: null }]);
  });

  it('sets the handle in the body', async () => {
    const me = fixtureMe({ handle: 'test_fixture2' });
    stub.use([{ method: 'PUT', path: '/v1/me/handle', reply: json(200, me) }]);

    const outcome = await changeHandle('test_fixture2');

    expect(outcome).toEqual({ ok: true, value: me });
    expect(stub.requests).toMatchObject([
      { method: 'PUT', path: '/v1/me/handle', query: {}, body: { handle: 'test_fixture2' } },
    ]);
  });

  it('answers a refusal with its code and fields', async () => {
    stub.use([
      {
        method: 'PATCH',
        path: '/v1/me',
        reply: apiError(400, 'invalid_request', { fields: { name: 'too_long' } }),
      },
    ]);

    const outcome = await updateProfile({ name: 'x' });

    expect(outcome).toEqual({
      ok: false,
      failure: {
        kind: 'api',
        code: 'invalid_request',
        status: 400,
        fields: { name: 'too_long' },
        retryAfterSeconds: null,
      },
    });
  });
});
