import type { UploadTicket } from '@citizenrun/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';

import {
  attachAvatar,
  checkHandle,
  createAvatarTicket,
  setHandle,
  setIssues,
  skipOnboardingStep,
} from './onboarding-requests';

const TICKET: UploadTicket = {
  uploadId: '01890000-0000-7000-8000-0000000000b1',
  key: 'incoming/01890000-0000-7000-8000-000000000001/01890000-0000-7000-8000-0000000000b1.jpg',
  method: 'POST',
  url: 'https://store.example.test/media',
  fields: {},
  headers: {},
  maxBytes: 8_388_608,
  expiresAt: '2027-01-15T12:05:00.000Z',
};

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([]);
  configureTestApiClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('onboarding requests', () => {
  it('skips a step with its name in the body', async () => {
    const me = fixtureMe({ onboardingStep: 'handle' });
    stub.use([{ method: 'POST', path: '/v1/me/onboarding/skip', reply: json(200, me) }]);

    const outcome = await skipOnboardingStep('photo');

    expect(outcome).toEqual({ ok: true, value: me });
    expect(stub.requests).toMatchObject([
      { method: 'POST', path: '/v1/me/onboarding/skip', query: {}, body: { step: 'photo' } },
    ]);
  });

  it('sets a handle', async () => {
    const me = fixtureMe({ handle: 'test_new', onboardingStep: 'issues' });
    stub.use([{ method: 'PUT', path: '/v1/me/handle', reply: json(200, me) }]);

    const outcome = await setHandle('test_new');

    expect(outcome).toEqual({ ok: true, value: me });
    expect(stub.requests).toMatchObject([
      { method: 'PUT', path: '/v1/me/handle', query: {}, body: { handle: 'test_new' } },
    ]);
  });

  it('checks a handle in the query string only', async () => {
    const answer = { handle: 'test_new', available: true, reason: null };
    stub.use([{ method: 'GET', path: '/v1/handles/check', reply: json(200, answer) }]);

    const outcome = await checkHandle('test_new', new AbortController().signal);

    expect(outcome).toEqual({ ok: true, value: answer });
    expect(stub.requests).toEqual([
      {
        method: 'GET',
        path: '/v1/handles/check',
        query: { handle: 'test_new' },
        body: null,
        hasSignal: true,
      },
    ]);
  });

  it('answers aborted when the check is cancelled', async () => {
    stub.use([{ method: 'GET', path: '/v1/handles/check', reply: { kind: 'hang' } }]);
    const controller = new AbortController();

    const pending = checkHandle('test_new', controller.signal);
    controller.abort();

    expect(await pending).toEqual({ ok: false, failure: { kind: 'aborted' } });
  });

  it('replaces the issues in the order given', async () => {
    const picks = [
      { issueId: 'rent-housing', starred: true },
      { issueId: 'climate', starred: false },
      { issueId: 'schools', starred: false },
    ];
    const me = fixtureMe({ issues: picks });
    stub.use([{ method: 'PUT', path: '/v1/me/issues', reply: json(200, me) }]);

    const outcome = await setIssues(picks);

    expect(outcome).toEqual({ ok: true, value: me });
    expect(stub.requests).toMatchObject([
      { method: 'PUT', path: '/v1/me/issues', query: {}, body: { issues: picks } },
    ]);
  });

  it('attaches an avatar by its key', async () => {
    const me = fixtureMe({ avatarPending: true, onboardingStep: 'handle' });
    stub.use([{ method: 'PATCH', path: '/v1/me', reply: json(200, me) }]);

    const outcome = await attachAvatar(TICKET.key);

    expect(outcome).toEqual({ ok: true, value: me });
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.body).toStrictEqual({ avatarUploadKey: TICKET.key });
    expect(stub.requests[0]?.query).toEqual({});
  });

  it('asks for an avatar ticket for a photo', async () => {
    stub.use([{ method: 'POST', path: '/v1/uploads', reply: json(201, TICKET) }]);

    const outcome = await createAvatarTicket({ contentType: 'image/jpeg', size: 480_000 });

    expect(outcome).toEqual({ ok: true, value: TICKET });
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.body).toStrictEqual({
      kind: 'photo',
      purpose: 'avatar',
      contentType: 'image/jpeg',
      size: 480_000,
    });
  });

  it('answers the refusal as a failure', async () => {
    stub.use([
      { method: 'POST', path: '/v1/uploads', reply: apiError(429, 'daily_limit_reached') },
    ]);

    const outcome = await createAvatarTicket({ contentType: 'image/jpeg', size: 480_000 });

    expect(outcome).toMatchObject({
      ok: false,
      failure: { kind: 'api', code: 'daily_limit_reached', status: 429 },
    });
  });
});
