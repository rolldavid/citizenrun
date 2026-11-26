import { LEGAL_VERSIONS } from '@citizenrun/shared';
import type { ConsentState, Me } from '@citizenrun/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetNavigationState } from '@/lib/navigation';
import { resetSessionPresence, setSessionPresence } from '@/lib/session-state';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { ageAssurance } from '@/platform/age-assurance';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, RecordedRequest, StubReply } from '@/test/api-stub';
import { ageAssuranceFake } from '@/test/platform/age-assurance';
import { queryClientFake } from '@/test/platform/query-client';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock, routerCalls } from '@/test/router-mock';

import { readMeFromCache } from '../data/me';
import { resetSystemState, setBoot } from '../data/system-state';

import { useAgreementsViewModel } from './use-agreements-view-model';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

const VERSION = '2027-02-01';

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([]);
  configureTestApiClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
  resetSystemState();
});

/** A Me whose terms and content policy changed to VERSION and wait for agreement. */
function changedMe(): Me {
  const me = fixtureMe();
  const changed = { agreedVersion: LEGAL_VERSIONS.terms, currentVersion: VERSION };
  return fixtureMe({
    consents: {
      ...me.consents,
      terms: changed,
      contentPolicy: { agreedVersion: LEGAL_VERSIONS.content_policy, currentVersion: VERSION },
      needed: ['terms', 'content_policy'],
    },
  });
}

function consentsWith(me: Me, needed: ConsentState['needed']): ConsentState {
  return { ...me.consents, needed };
}

/** A signed-in person whose Me the stub answers, and the answers to each E-ME-11 post in turn. */
function signedIn(
  me: Me,
  consentReply: (request: RecordedRequest, index: number) => StubReply,
): void {
  stub.use([
    { method: 'GET', path: '/v1/me', reply: json(200, me) },
    { method: 'POST', path: '/v1/me/consents', reply: consentReply },
  ]);
  setBoot('ready');
  setSessionPresence('present');
}

function posts() {
  return stub.requests.filter((request) => request.method === 'POST');
}

async function loadedHook() {
  const hook = renderHookWithClient(() => useAgreementsViewModel());
  await waitFor(() => {
    expect(hook.result.current.needed).not.toHaveLength(0);
  });
  return hook;
}

describe('useAgreementsViewModel', () => {
  it('lists the changed documents and the three links', async () => {
    const me = changedMe();
    signedIn(me, () => json(200, consentsWith(me, [])));
    const hook = renderHookWithClient(() => useAgreementsViewModel());
    expect(hook.result.current.needed).toEqual([]);

    await waitFor(() => {
      expect(hook.result.current.needed).toEqual(['terms', 'content_policy']);
    });
    expect(hook.result.current).toMatchObject({
      links: {
        terms: 'http://api.test/terms',
        contentPolicy: 'http://api.test/content-policy',
        privacyPolicy: 'http://api.test/privacy',
      },
      status: 'idle',
      errorCode: null,
      deleteHref: '/settings/delete-account',
    });
  });

  it('records each document with its current version after the acknowledgement where required', async () => {
    vi.spyOn(ageAssurance, 'significantUpdateAcknowledgmentRequired').mockResolvedValue(true);
    const me = changedMe();
    const acknowledgedAtPost: number[] = [];
    signedIn(me, (_request, index) => {
      acknowledgedAtPost.push(
        ageAssuranceFake.calls.filter((call) => call.op === 'acknowledgeSignificantUpdate').length,
      );
      return json(200, consentsWith(me, index === 0 ? ['content_policy'] : []));
    });
    const hook = await loadedHook();

    act(() => {
      hook.result.current.onAgree();
    });
    expect(hook.result.current.status).toBe('saving');

    await waitFor(() => {
      expect(hook.result.current.needed).toEqual([]);
    });
    expect(hook.result.current.status).toBe('idle');
    expect(hook.result.current.errorCode).toBeNull();
    expect(acknowledgedAtPost).toEqual([1, 1]);
    expect(posts().map((request) => [request.path, request.body])).toEqual([
      ['/v1/me/consents', { kind: 'terms', version: VERSION, granted: true }],
      ['/v1/me/consents', { kind: 'content_policy', version: VERSION, granted: true }],
    ]);
    expect(readMeFromCache(hook.client)?.consents.needed).toEqual([]);
    expect(routerCalls).toEqual([]);
  });

  it('records without the acknowledgement where it is not required', async () => {
    const me = changedMe();
    signedIn(me, (_request, index) =>
      json(200, consentsWith(me, index === 0 ? ['content_policy'] : [])),
    );
    const hook = await loadedHook();

    act(() => {
      hook.result.current.onAgree();
    });
    await waitFor(() => {
      expect(hook.result.current.needed).toEqual([]);
    });
    expect(posts()).toHaveLength(2);
    expect(ageAssuranceFake.calls).not.toContainEqual({ op: 'acknowledgeSignificantUpdate' });
  });

  it('records the documents when the acknowledgement fails', async () => {
    vi.spyOn(ageAssurance, 'significantUpdateAcknowledgmentRequired').mockResolvedValue(true);
    vi.spyOn(ageAssurance, 'acknowledgeSignificantUpdate').mockRejectedValue(new Error('declined'));
    const me = changedMe();
    signedIn(me, (_request, index) =>
      json(200, consentsWith(me, index === 0 ? ['content_policy'] : [])),
    );
    const hook = await loadedHook();

    act(() => {
      hook.result.current.onAgree();
    });
    await waitFor(() => {
      expect(hook.result.current.needed).toEqual([]);
    });
    expect(posts()).toHaveLength(2);
    expect(hook.result.current.status).toBe('idle');
  });

  it('shows a refusal and sends only the rest on retry', async () => {
    const me = changedMe();
    signedIn(me, (_request, index) => {
      if (index === 0) return json(200, consentsWith(me, ['content_policy']));
      if (index === 1) return apiError(503, 'unavailable');
      return json(200, consentsWith(me, []));
    });
    const hook = await loadedHook();

    act(() => {
      hook.result.current.onAgree();
    });
    await waitFor(() => {
      expect(hook.result.current.status).toBe('error');
    });
    expect(hook.result.current.errorCode).toBe('unavailable');
    expect(hook.result.current.needed).toEqual(['content_policy']);

    act(() => {
      hook.result.current.onAgree();
    });
    expect(hook.result.current.errorCode).toBeNull();
    await waitFor(() => {
      expect(hook.result.current.needed).toEqual([]);
    });
    expect(hook.result.current.status).toBe('idle');
    expect(posts().map((request) => request.body)).toEqual([
      { kind: 'terms', version: VERSION, granted: true },
      { kind: 'content_policy', version: VERSION, granted: true },
      { kind: 'content_policy', version: VERSION, granted: true },
    ]);
  });

  it('ignores a second press while saving', async () => {
    const me = changedMe();
    const oneDocument = fixtureMe({ consents: { ...me.consents, needed: ['terms'] } });
    signedIn(oneDocument, () => json(200, consentsWith(oneDocument, [])));
    const hook = await loadedHook();

    act(() => {
      hook.result.current.onAgree();
      hook.result.current.onAgree();
    });
    act(() => {
      hook.result.current.onAgree();
    });
    await waitFor(() => {
      expect(hook.result.current.needed).toEqual([]);
    });
    expect(posts()).toHaveLength(1);
  });

  it('does nothing before Me has loaded', async () => {
    stub.use([{ method: 'GET', path: '/v1/me', reply: { kind: 'hang' } }]);
    setBoot('ready');
    setSessionPresence('present');
    const hook = renderHookWithClient(() => useAgreementsViewModel());

    act(() => {
      hook.result.current.onAgree();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current.status).toBe('idle');
    expect(posts()).toEqual([]);
  });

  it('sends nothing while offline and shows that the service cannot be reached', async () => {
    const me = changedMe();
    signedIn(me, () => json(200, consentsWith(me, [])));
    const hook = await loadedHook();

    act(() => {
      queryClientFake.setOnline(false);
    });
    act(() => {
      hook.result.current.onAgree();
    });
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.errorCode).toBe('unavailable');
    expect(posts()).toEqual([]);
  });
});
