import { LEGAL_VERSIONS } from '@citizenrun/shared';
import type { ConsentState } from '@citizenrun/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { queryClient } from '@/platform/query-client';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';

import { recordAgreements, recordAiScreening } from './consents';
import { readMeFromCache, writeMeToCache } from './me';

const VERSION = '2027-02-01';

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([]);
  configureTestApiClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A Me whose three documents changed to VERSION and still wait for agreement. */
function changedMe() {
  const me = fixtureMe();
  const changed = { agreedVersion: LEGAL_VERSIONS.terms, currentVersion: VERSION };
  return fixtureMe({
    consents: {
      ...me.consents,
      terms: changed,
      contentPolicy: changed,
      privacyPolicy: changed,
      needed: ['terms', 'privacy_policy'],
    },
  });
}

function consentsAfter(
  me: ReturnType<typeof changedMe>,
  needed: ConsentState['needed'],
): ConsentState {
  return { ...me.consents, needed };
}

describe('recordAgreements', () => {
  it('records each needed agreement with its current version, in order', async () => {
    const me = changedMe();
    const client = queryClient.get();
    writeMeToCache(client, me);
    stub.use([
      {
        method: 'POST',
        path: '/v1/me/consents',
        reply: (_request, index) =>
          json(200, consentsAfter(me, index === 0 ? ['privacy_policy'] : [])),
      },
    ]);

    const outcome = await recordAgreements(['terms', 'privacy_policy'], me, client);

    expect(outcome).toEqual({ ok: true, value: undefined });
    expect(stub.requests.map((request) => [request.method, request.path, request.body])).toEqual([
      ['POST', '/v1/me/consents', { kind: 'terms', version: VERSION, granted: true }],
      ['POST', '/v1/me/consents', { kind: 'privacy_policy', version: VERSION, granted: true }],
    ]);
    expect(readMeFromCache(client)?.consents.needed).toEqual([]);
  });

  it('stops at the first refusal and keeps what was recorded', async () => {
    const me = changedMe();
    const client = queryClient.get();
    writeMeToCache(client, me);
    stub.use([
      {
        method: 'POST',
        path: '/v1/me/consents',
        reply: (_request, index) =>
          index === 0
            ? json(200, consentsAfter(me, ['privacy_policy']))
            : apiError(422, 'consent_version_outdated'),
      },
    ]);

    const outcome = await recordAgreements(['terms', 'privacy_policy'], me, client);

    expect(outcome.ok).toBe(false);
    expect(!outcome.ok && outcome.failure.kind === 'api' && outcome.failure.code).toBe(
      'consent_version_outdated',
    );
    expect(stub.requests).toHaveLength(2);
    expect(readMeFromCache(client)?.consents.needed).toEqual(['privacy_policy']);
  });

  it('sends nothing more after a failed first document', async () => {
    const me = changedMe();
    stub.use([{ method: 'POST', path: '/v1/me/consents', reply: { kind: 'network_error' } }]);
    const outcome = await recordAgreements(['terms', 'privacy_policy'], me, queryClient.get());
    expect(outcome).toEqual({ ok: false, failure: { kind: 'network' } });
    expect(stub.requests).toHaveLength(1);
  });
});

describe('recordAiScreening', () => {
  it('records the AI-screening answer with its version', async () => {
    const me = fixtureMe();
    const client = queryClient.get();
    writeMeToCache(client, me);
    const answered: ConsentState = { ...me.consents, aiScreening: 'declined' };
    stub.use([{ method: 'POST', path: '/v1/me/consents', reply: json(200, answered) }]);

    const outcome = await recordAiScreening(false, client);

    expect(outcome).toEqual({ ok: true, value: answered });
    expect(stub.requests.map((request) => request.body)).toEqual([
      { kind: 'ai_screening', version: LEGAL_VERSIONS.ai_screening, granted: false },
    ]);
    expect(readMeFromCache(client)?.consents.aiScreening).toBe('declined');
  });
});
