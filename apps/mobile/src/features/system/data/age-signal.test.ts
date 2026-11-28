import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetNavigationState } from '@/lib/navigation';
import { getSessionPresence, resetSessionPresence, setSessionPresence } from '@/lib/session-state';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { queryClient } from '@/platform/query-client';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';
import { ageAssuranceFake } from '@/test/platform/age-assurance';
import { sessionFake } from '@/test/platform/session';
import { resetRouterMock } from '@/test/router-mock';

import { coldStartAgeAction, resetColdStartAgeCheck, runColdStartAgeCheck } from './age-signal';
import { readMeFromCache } from './me';
import { isMinorEnded, resetSystemState } from './system-state';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

const CHECKED_AT = '2027-01-20T12:00:00.000Z';
const DELETION = {
  deletionRequestedAt: '2027-01-20T12:00:00.000Z',
  completesBy: '2027-02-19T12:00:00.000Z',
};

let stub: ApiStub;

beforeEach(() => {
  resetColdStartAgeCheck();
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

const noSignal = fixtureMe();
// A record made while sign-up asked a birth month.
const selfDeclared = fixtureMe({
  age: { method: 'self_declared', sourceTier: 'self', checkedAt: CHECKED_AT },
});
const storeRecord = fixtureMe({
  age: { method: 'store_signal', sourceTier: 'confirmed', checkedAt: CHECKED_AT },
});

function endLocalCalls() {
  return sessionFake.calls.filter((call) => call.op === 'endLocal');
}

function storeAsks() {
  return ageAssuranceFake.calls.filter((call) => call.op === 'requestStoreSignal');
}

describe('coldStartAgeAction', () => {
  it('decides what a cold-start signal reports', () => {
    expect(
      coldStartAgeAction({ kind: 'minor', tier: 'declared', under13: false }, noSignal),
    ).toEqual({ kind: 'post', body: { result: 'under_18', sourceTier: 'declared' } });
    expect(
      coldStartAgeAction({ kind: 'minor', tier: 'confirmed', under13: true }, storeRecord),
    ).toEqual({ kind: 'post', body: { result: 'under_13', sourceTier: 'confirmed' } });
    expect(noSignal.age?.method).toBe('none');
    for (const me of [noSignal, selfDeclared]) {
      expect(coldStartAgeAction({ kind: 'adult', tier: 'confirmed' }, me)).toEqual({
        kind: 'post',
        body: { result: 'adult', sourceTier: 'confirmed' },
      });
    }
    expect(coldStartAgeAction({ kind: 'adult', tier: 'declared' }, storeRecord)).toEqual({
      kind: 'none',
    });
    expect(coldStartAgeAction({ kind: 'unavailable' }, noSignal)).toEqual({ kind: 'none' });
    expect(
      coldStartAgeAction({ kind: 'adult', tier: 'declared' }, fixtureMe({ age: null })),
    ).toEqual({ kind: 'none' });
  });
});

describe('runColdStartAgeCheck', () => {
  it('reports a minor signal, then ends the session on this device', async () => {
    setSessionPresence('present');
    ageAssuranceFake.scriptSignal({ kind: 'minor', tier: 'declared', under13: false });
    stub.use([{ method: 'POST', path: '/v1/me/age', reply: json(202, DELETION) }]);

    const answer = await runColdStartAgeCheck(noSignal, queryClient.get());

    expect(answer).toBe('minor_ended');
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.body).toStrictEqual({ result: 'under_18', sourceTier: 'declared' });
    expect(endLocalCalls()).toEqual([{ op: 'endLocal', reason: 'account_minor' }]);
    expect(isMinorEnded()).toBe(true);
    expect(getSessionPresence()).toBe('absent');
  });

  it('replaces a record with no signal by an adult signal', async () => {
    const client = queryClient.get();
    ageAssuranceFake.scriptSignal({ kind: 'adult', tier: 'declared' });
    const upgraded = fixtureMe({
      age: { method: 'store_signal', sourceTier: 'declared', checkedAt: CHECKED_AT },
    });
    stub.use([{ method: 'POST', path: '/v1/me/age', reply: json(200, upgraded) }]);

    const answer = await runColdStartAgeCheck(noSignal, client);

    expect(answer).toBe('adult_recorded');
    expect(stub.requests.map((request) => request.body)).toStrictEqual([
      { result: 'adult', sourceTier: 'declared' },
    ]);
    expect(readMeFromCache(client)?.age?.method).toBe('store_signal');
    expect(endLocalCalls()).toEqual([]);
  });

  it('keeps the cache when the adult answer is not a Me', async () => {
    const client = queryClient.get();
    stub.use([{ method: 'POST', path: '/v1/me/age', reply: json(200, { unexpected: true }) }]);
    expect(await runColdStartAgeCheck(noSignal, client)).toBe('adult_recorded');
    expect(readMeFromCache(client)).toBeNull();
  });

  it('sends nothing for an adult with a store record or an unavailable signal', async () => {
    ageAssuranceFake.scriptSignal({ kind: 'adult', tier: 'confirmed' });
    expect(await runColdStartAgeCheck(storeRecord, queryClient.get())).toBe('none');

    resetColdStartAgeCheck();
    ageAssuranceFake.scriptSignal({ kind: 'unavailable' });
    expect(await runColdStartAgeCheck(noSignal, queryClient.get())).toBe('none');

    expect(storeAsks()).toHaveLength(2);
    expect(stub.requests).toEqual([]);
  });

  it('asks the store once per process', async () => {
    await runColdStartAgeCheck(storeRecord, queryClient.get());
    expect(await runColdStartAgeCheck(storeRecord, queryClient.get())).toBe('none');
    expect(storeAsks()).toHaveLength(1);
  });

  it('keeps the session when the report fails', async () => {
    setSessionPresence('present');
    ageAssuranceFake.scriptSignal({ kind: 'minor', tier: 'confirmed', under13: false });
    stub.use([{ method: 'POST', path: '/v1/me/age', reply: apiError(500, 'internal') }]);

    const answer = await runColdStartAgeCheck(noSignal, queryClient.get());

    expect(answer).toBe('failed');
    expect(endLocalCalls()).toEqual([]);
    expect(isMinorEnded()).toBe(false);
    expect(getSessionPresence()).toBe('present');
  });

  it('never asks where the store signal is not supported', async () => {
    ageAssuranceFake.setStoreSignalSupported(false);
    ageAssuranceFake.scriptSignal({ kind: 'minor', tier: 'declared', under13: false });
    expect(await runColdStartAgeCheck(noSignal, queryClient.get())).toBe('none');
    expect(storeAsks()).toEqual([]);
    expect(stub.requests).toEqual([]);
  });
});
