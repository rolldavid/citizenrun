import type { CandidacyView, OfficeDetail } from '@citizenrun/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { markNavigationReady, resetNavigationState } from '@/lib/navigation';
import { subscribeOptimisticFailures } from '@/lib/optimistic-failures';
import type { OptimisticFailure } from '@/lib/optimistic-failures';
import { resetSessionPresence, setSessionPresence } from '@/lib/session-state';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubReply, StubRoute } from '@/test/api-stub';
import { queryClientFake } from '@/test/platform/query-client';
import { renderHookWithClient } from '@/test/render-hook';
import { resetRouterMock, routerCalls } from '@/test/router-mock';

import { officeCandidates, officeReady } from './office.fixtures';
import type { OfficeReadyData, OfficeViewModel } from './office.types';
import { useOfficeViewModel } from './use-office-view-model';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({ default: { expoConfig: null } }));

function readyOf(vm: OfficeViewModel): OfficeReadyData {
  if (vm.status !== 'ready') throw new Error(`expected ready, got ${vm.status}`);
  return vm.data;
}

const FIXTURE = readyOf(officeReady);
const OFFICE: OfficeDetail = FIXTURE.office;
const SLUG = OFFICE.slug;
const DETAIL_PATH = `/v1/offices/${SLUG}`;
const ISSUES: StubRoute = {
  method: 'GET',
  path: '/v1/issues',
  reply: json(200, { items: FIXTURE.issues, nextCursor: null }),
};

function detailRoute(reply: StubReply | ((index: number) => StubReply)): StubRoute {
  return {
    method: 'GET',
    path: DETAIL_PATH,
    reply: (_request, index) => (typeof reply === 'function' ? reply(index) : reply),
  };
}

let stub: ApiStub;
const failures: OptimisticFailure[] = [];
let unsubscribe: () => void = () => undefined;

beforeEach(() => {
  stub = installApiStub([]);
  configureTestApiClient();
  markNavigationReady();
  failures.length = 0;
  unsubscribe = subscribeOptimisticFailures((failure) => failures.push(failure));
});

afterEach(() => {
  unsubscribe();
  vi.unstubAllGlobals();
  resetRouterMock();
  resetNavigationState();
  resetSessionPresence();
});

/** Mounts the hook and records the status of every render. */
function mount() {
  const seen: { status: OfficeViewModel['status'] }[] = [];
  const hook = renderHookWithClient(() => {
    const vm = useOfficeViewModel(SLUG);
    seen.push({ status: vm.status });
    return vm;
  });
  return Object.assign(hook, { seen });
}

async function loaded() {
  const hook = mount();
  await waitFor(() => {
    expect(hook.result.current.status).toBe('ready');
  });
  return hook;
}

/** Holds every POST until the returned function is called; other requests go straight through. */
function holdPosts(): () => void {
  const stubbed = globalThis.fetch;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') {
      await gate;
    }
    return stubbed(input, init);
  });
  return release;
}

function requests(method: string, path: string) {
  return stub.requests.filter((request) => request.method === method && request.path === path);
}

function candidacies(count: number): CandidacyView[] {
  const [first] = readyOf(officeCandidates).office.candidates as [CandidacyView];
  return Array.from({ length: count }, (_each, index) => ({
    ...first,
    id: `01890000-0000-7000-8000-${String(200 + index).padStart(12, '0')}`,
  }));
}

describe('useOfficeViewModel', () => {
  it('loads by slug', async () => {
    stub.use([ISSUES, detailRoute(json(200, OFFICE))]);
    const hook = mount();
    expect(hook.result.current.status).toBe('loading');

    await waitFor(() => {
      expect(hook.result.current.status).toBe('ready');
    });
    const data = readyOf(hook.result.current);
    expect(data.office).toEqual(OFFICE);
    expect(data.issues).toEqual(FIXTURE.issues);
    expect(data.actions.runState).toBe('hidden');
    expect(requests('GET', DETAIL_PATH)[0]?.query).toEqual({});
  });

  it('not found', async () => {
    stub.use([ISSUES, detailRoute(apiError(404, 'not_found'))]);
    const hook = mount();

    await waitFor(() => {
      expect(hook.result.current).toMatchObject({ status: 'error', code: 'not_found' });
    });
  });

  it('choosing an issue refetches and stays ready', async () => {
    const single: OfficeDetail = { ...OFFICE, impactMode: 'single_issue', impactIssueId: null };
    stub.use([ISSUES, detailRoute(json(200, single))]);
    const hook = await loaded();
    const readyAt = hook.seen.length;
    const choice = readyOf(hook.result.current).singleIssue;
    expect(choice).not.toBeNull();

    act(() => {
      choice?.onSelect('climate');
    });

    await waitFor(() => {
      expect(requests('GET', DETAIL_PATH)).toHaveLength(2);
    });
    expect(requests('GET', DETAIL_PATH)[1]?.query).toEqual({ issue: 'climate' });
    await waitFor(() => {
      expect(hook.result.current.status === 'ready' && hook.result.current.refreshing).toBe(false);
    });
    expect(hook.seen.slice(readyAt).every((render) => render.status === 'ready')).toBe(true);
  });

  it('signed out follow goes to sign-in', async () => {
    setSessionPresence('absent');
    stub.use([ISSUES, detailRoute(json(200, OFFICE))]);
    const hook = await loaded();

    act(() => {
      readyOf(hook.result.current).actions.onToggleFollow();
    });

    expect(routerCalls).toEqual([
      { op: 'push', path: '/sign-in?next=%2Foffice%2Fcounty-treasurer-wren' },
    ]);
    expect(stub.requests.filter((request) => request.method === 'POST')).toEqual([]);
    expect(readyOf(hook.result.current).fieldReport).toBeNull();
  });

  it('follow is optimistic and rolls back', async () => {
    setSessionPresence('present');
    stub.use([
      ISSUES,
      detailRoute(json(200, OFFICE)),
      {
        method: 'POST',
        path: `/v1/offices/${OFFICE.id}/follow`,
        reply: apiError(429, 'daily_limit_reached'),
      },
    ]);
    const hook = await loaded();
    // The follow request waits until the test lets it through, so the flipped state is seen first.
    const answer = holdPosts();

    act(() => {
      readyOf(hook.result.current).actions.onToggleFollow();
    });

    await waitFor(() => {
      expect(readyOf(hook.result.current).actions.following).toBe(true);
    });
    expect(failures).toEqual([]);

    answer();
    await waitFor(() => {
      expect(failures).toHaveLength(1);
    });
    await waitFor(() => {
      expect(readyOf(hook.result.current).actions.following).toBe(false);
    });
    expect(failures[0]).toMatchObject({ action: 'follow', code: 'daily_limit_reached' });
    expect(requests('POST', `/v1/offices/${OFFICE.id}/follow`)).toHaveLength(1);
  });

  it('bookmark persists', async () => {
    setSessionPresence('present');
    const saved: OfficeDetail = { ...OFFICE, viewer: { ...OFFICE.viewer, bookmarked: true } };
    stub.use([
      ISSUES,
      detailRoute((index) => json(200, index === 0 ? OFFICE : saved)),
      {
        method: 'POST',
        path: `/v1/offices/${OFFICE.id}/bookmark`,
        reply: json(200, { bookmarked: true }),
      },
    ]);
    const hook = await loaded();

    act(() => {
      readyOf(hook.result.current).actions.onToggleBookmark();
    });

    await waitFor(() => {
      expect(requests('GET', DETAIL_PATH)).toHaveLength(2);
    });
    await waitFor(() => {
      expect(hook.result.current.status === 'ready' && hook.result.current.refreshing).toBe(false);
    });
    expect(readyOf(hook.result.current).actions.bookmarked).toBe(true);
    expect(requests('POST', `/v1/offices/${OFFICE.id}/bookmark`)).toHaveLength(1);
    expect(failures).toEqual([]);
  });

  it('show all loads every page', async () => {
    const all = candidacies(70);
    const withCount: OfficeDetail = { ...OFFICE, candidates: all.slice(0, 5), candidatesCount: 70 };
    const candidatesPath = `/v1/offices/${OFFICE.id}/candidates`;
    stub.use([
      ISSUES,
      detailRoute(json(200, withCount)),
      {
        method: 'GET',
        path: candidatesPath,
        reply: (request) =>
          request.query.cursor === 'page-2'
            ? json(200, { items: all.slice(50), nextCursor: null })
            : json(200, { items: all.slice(0, 50), nextCursor: 'page-2' }),
      },
    ]);
    const hook = await loaded();
    expect(readyOf(hook.result.current).candidates.entries).toHaveLength(5);
    const showAll = readyOf(hook.result.current).candidates.onShowAll;
    expect(showAll).not.toBeNull();

    act(() => {
      showAll?.();
    });

    await waitFor(() => {
      expect(readyOf(hook.result.current).candidates.entries).toHaveLength(70);
    });
    const pages = requests('GET', candidatesPath);
    expect(pages).toHaveLength(2);
    expect(pages[0]?.query).toEqual({ limit: '50' });
    expect(pages[1]?.query).toEqual({ limit: '50', cursor: 'page-2' });
    expect(readyOf(hook.result.current).candidates.onShowAll).toBeNull();
    expect(readyOf(hook.result.current).candidates.total).toBe(70);
  });

  it('field report states', async () => {
    setSessionPresence('present');
    const reportPath = `/v1/offices/${OFFICE.id}/field-reports`;
    stub.use([
      ISSUES,
      detailRoute(json(200, OFFICE)),
      {
        method: 'POST',
        path: reportPath,
        reply: (_request, index) =>
          index === 0
            ? json(201, { id: '01890000-0000-7000-8000-000000000301' })
            : apiError(422, index === 1 ? 'account_too_new' : 'link_invalid'),
      },
    ]);
    const hook = await loaded();
    const report = () => {
      const value = readyOf(hook.result.current).fieldReport;
      if (value === null) throw new Error('expected a field report');
      return value;
    };

    act(() => {
      report().onSubmit({ field: 'filing_deadline', message: 'Fixture note.', sourceUrl: null });
    });
    expect(report().status).toBe('sending');
    await waitFor(() => {
      expect(report().status).toBe('sent');
    });
    expect(requests('POST', reportPath)[0]?.body).toEqual({
      field: 'filing_deadline',
      message: 'Fixture note.',
      sourceUrl: null,
    });

    act(() => {
      report().onReset();
    });
    expect(report()).toMatchObject({ status: 'idle', errorCode: null });

    act(() => {
      report().onSubmit({ message: 'Fixture note.' });
    });
    await waitFor(() => {
      expect(report()).toMatchObject({ status: 'error', errorCode: 'account_too_new' });
    });

    act(() => {
      report().onSubmit({ sourceUrl: 'https://example.test/fixture' });
    });
    await waitFor(() => {
      expect(report()).toMatchObject({ status: 'error', errorCode: 'link_invalid' });
    });

    act(() => {
      report().onReset();
    });
    expect(report()).toMatchObject({ status: 'idle', errorCode: null });
    expect(requests('POST', reportPath)).toHaveLength(3);
  });

  it('no report while offline', async () => {
    setSessionPresence('present');
    stub.use([ISSUES, detailRoute(json(200, OFFICE))]);
    const hook = await loaded();

    act(() => {
      queryClientFake.setOnline(false);
    });
    act(() => {
      readyOf(hook.result.current).fieldReport?.onSubmit({ message: 'Fixture note.' });
    });

    expect(readyOf(hook.result.current).fieldReport?.status).toBe('idle');
    expect(stub.requests.filter((request) => request.method === 'POST')).toEqual([]);
  });
});
