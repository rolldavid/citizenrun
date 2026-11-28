import type { PersonDetail } from '@citizenrun/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { markNavigationReady, resetNavigationState } from '@/lib/navigation';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubReply, StubRoute } from '@/test/api-stub';
import { linksFake } from '@/test/platform/links';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock, routerCalls } from '@/test/router-mock';

import { personOfficeholder } from './person.fixtures';
import type { PersonReadyData, PersonViewModel } from './person.types';
import { usePersonViewModel } from './use-person-view-model';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({ default: { expoConfig: null } }));

function readyOf(vm: PersonViewModel): PersonReadyData {
  if (vm.status !== 'ready') throw new Error(`expected ready, got ${vm.status}`);
  return vm.data;
}

const CAROL: PersonDetail = readyOf(personOfficeholder).person;
const SLUG = CAROL.slug;
const OFFICE_SLUG = 'county-treasurer-wren';
const OFFICE_PATH = `/v1/offices/${OFFICE_SLUG}`;

function personRoute(slug: string, reply: StubReply): StubRoute {
  return { method: 'GET', path: `/v1/people/${slug}`, reply };
}

/** E-OFF-01 for the current seat's office. The page reads `partisan` and nothing else of it. */
function officeRoute(reply: StubReply): StubRoute {
  return { method: 'GET', path: OFFICE_PATH, reply };
}

let stub: ApiStub;

beforeEach(() => {
  stub = installApiStub([]);
  configureTestApiClient();
  markNavigationReady();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRouterMock();
  resetNavigationState();
});

function requests(path: string) {
  return stub.requests.filter((request) => request.method === 'GET' && request.path === path);
}

/** Every request for an office, whichever office it names. */
function officeRequests() {
  return stub.requests.filter((request) => request.path.startsWith('/v1/offices/'));
}

async function loaded(slug: string = SLUG) {
  const hook = renderHookWithClient(() => usePersonViewModel(slug));
  await waitFor(() => {
    expect(hook.result.current.status).toBe('ready');
  });
  return hook;
}

describe('usePersonViewModel', () => {
  it('loads and looks up the current office', async () => {
    stub.use([personRoute(SLUG, json(200, CAROL)), officeRoute(json(200, { partisan: true }))]);
    const hook = renderHookWithClient(() => usePersonViewModel(SLUG));
    expect(hook.result.current).toEqual({ status: 'loading' });
    await waitFor(() => {
      expect(hook.result.current.status).toBe('ready');
    });
    // The page is ready before the office answers, with no party, and gains it when it does.
    await waitFor(() => {
      expect(readyOf(hook.result.current).showParty).toBe(true);
    });
    const data = readyOf(hook.result.current);
    expect(data.person).toEqual(CAROL);
    expect(data.seats.map((each) => each.officeHref)).toEqual([
      '/office/county-treasurer-wren',
      '/office/deputy-treasurer-wren',
    ]);
    expect(requests(`/v1/people/${SLUG}`)).toHaveLength(1);
    expect(requests(OFFICE_PATH)).toHaveLength(1);
    expect(officeRequests()).toHaveLength(1);
    expect(routerCalls).toEqual([]);
  });

  it('the party stays off while the office has not answered', async () => {
    stub.use([personRoute(SLUG, json(200, CAROL)), officeRoute({ kind: 'hang' })]);
    const hook = await loaded();
    expect(requests(OFFICE_PATH)).toHaveLength(1);
    expect(readyOf(hook.result.current).showParty).toBe(false);
  });

  it('a nonpartisan office shows no party', async () => {
    stub.use([personRoute(SLUG, json(200, CAROL)), officeRoute(json(200, { partisan: false }))]);
    const hook = await loaded();
    await waitFor(() => {
      expect(hook.client.isFetching()).toBe(0);
    });
    expect(requests(OFFICE_PATH)).toHaveLength(1);
    expect(readyOf(hook.result.current).showParty).toBe(false);
  });

  it('no lookup without a current seat', async () => {
    const past = CAROL.seats.map((seat) => ({ ...seat, until: '2018-12-31', current: false }));
    stub.use([personRoute(SLUG, json(200, { ...CAROL, seats: past }))]);
    const hook = await loaded();
    await waitFor(() => {
      expect(hook.client.isFetching()).toBe(0);
    });
    expect(officeRequests()).toEqual([]);
    expect(readyOf(hook.result.current).showParty).toBe(false);
    // A refresh reads the person again and still asks for no office.
    act(() => {
      readyOf(hook.result.current).onRefresh();
    });
    await waitFor(() => {
      expect(requests(`/v1/people/${SLUG}`)).toHaveLength(2);
    });
    await waitFor(() => {
      expect(hook.client.isFetching()).toBe(0);
    });
    expect(officeRequests()).toEqual([]);
  });

  it('a failed lookup leaves the tag off', async () => {
    stub.use([personRoute(SLUG, json(200, CAROL)), officeRoute(apiError(500, 'internal'))]);
    const hook = await loaded();
    await waitFor(() => {
      expect(hook.client.isFetching()).toBe(0);
    });
    expect(requests(OFFICE_PATH)).toHaveLength(1);
    expect(hook.result.current.status).toBe('ready');
    expect(readyOf(hook.result.current).showParty).toBe(false);
  });

  it('not found', async () => {
    stub.use([personRoute(SLUG, apiError(404, 'not_found'))]);
    const hook = renderHookWithClient(() => usePersonViewModel(SLUG));
    await waitFor(() => {
      expect(hook.result.current.status).toBe('error');
    });
    expect(hook.result.current).toMatchObject({ status: 'error', code: 'not_found' });
    expect(officeRequests()).toEqual([]);
    expect(routerCalls).toEqual([]);
  });

  it('a merged person moves the route', async () => {
    stub.use([
      personRoute('old-name', json(200, CAROL)),
      officeRoute(json(200, { partisan: true })),
    ]);
    const hook = await loaded('old-name');
    await waitFor(() => {
      expect(routerCalls).toEqual([{ op: 'replace', path: '/c/carol-wynn' }]);
    });
    // Nothing the page draws again moves the route a second time.
    await waitFor(() => {
      expect(readyOf(hook.result.current).showParty).toBe(true);
    });
    hook.rerender();
    expect(routerCalls).toEqual([{ op: 'replace', path: '/c/carol-wynn' }]);
  });

  it('refresh reads the person and the office again', async () => {
    stub.use([personRoute(SLUG, json(200, CAROL)), officeRoute(json(200, { partisan: true }))]);
    const hook = await loaded();
    await waitFor(() => {
      expect(readyOf(hook.result.current).showParty).toBe(true);
    });
    act(() => {
      readyOf(hook.result.current).onRefresh();
    });
    await waitFor(() => {
      expect(requests(`/v1/people/${SLUG}`)).toHaveLength(2);
      expect(requests(OFFICE_PATH)).toHaveLength(2);
    });
  });

  it('the website opens through the links module', async () => {
    stub.use([personRoute(SLUG, json(200, CAROL)), officeRoute(json(200, { partisan: true }))]);
    const hook = await loaded();
    readyOf(hook.result.current).links.website?.();
    expect(linksFake.calls).toEqual([{ op: 'openExternal', url: 'https://carolwynn.example' }]);
  });
});
