import { ApiError } from '@citizenrun/shared';
import {
  getGetOfficeQueryKey,
  getListOfficesInfiniteQueryKey,
  getListOfficesQueryKey,
} from '@citizenrun/shared/api';
import { onlineManager } from '@tanstack/react-query';
import type { QueryClient, QueryFilters, QueryKey } from '@tanstack/react-query';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { subscribeOptimisticFailures } from '@/lib/optimistic-failures';
import type { OptimisticFailure } from '@/lib/optimistic-failures';
import { queryClientFake } from '@/test/platform/query-client';
import { renderHookWithClient } from '@/test/render-hook';

import { useOptimisticToggle } from './optimistic';
import type { CachePlace } from './optimistic';

// The helper with one office as it may sit in the cache: by slug, by id, in a list page and in
// the pages of an infinite list. The places and the patch are this test's own.

type Viewer = { following: boolean; bookmarked: boolean };
type CachedOffice = { id: string; slug: string; viewer: Viewer };
type CachedPage = { items: CachedOffice[]; nextCursor: string | null };
type CachedPages = { pages: CachedPage[]; pageParams: unknown[] };

const OFFICE: CachedOffice = {
  id: '01890000-0000-7000-8000-000000000101',
  slug: 'county-treasurer-wren',
  viewer: { following: false, bookmarked: false },
};
const OTHER: CachedOffice = {
  id: '01890000-0000-7000-8000-000000000199',
  slug: 'other',
  viewer: { following: false, bookmarked: false },
};

const BY_SLUG = getGetOfficeQueryKey(OFFICE.slug);
const BY_ID = getGetOfficeQueryKey(OFFICE.id);
const LIST = getListOfficesQueryKey();
const PAGES = getListOfficesInfiniteQueryKey();

const OFFICES: QueryFilters = {
  predicate: (query) => {
    const [first, second] = query.queryKey;
    const path = first === 'infinite' ? second : first;
    return typeof path === 'string' && path.startsWith('/v1/offices');
  },
};

function setFollowing(value: unknown, following: boolean): unknown {
  const patchOne = (office: CachedOffice): CachedOffice =>
    office.id === OFFICE.id ? { ...office, viewer: { ...office.viewer, following } } : office;
  const patchPage = (page: CachedPage): CachedPage => ({
    ...page,
    items: page.items.map(patchOne),
  });
  if (typeof value !== 'object' || value === null) return value;
  if ('pages' in value) {
    const pages = value as CachedPages; // the infinite shape this test caches
    return { ...pages, pages: pages.pages.map(patchPage) };
  }
  if ('items' in value) return patchPage(value as CachedPage); // the page shape this test caches
  return patchOne(value as CachedOffice); // the office shape this test caches
}

const PLACES: readonly CachePlace[] = [
  { filters: OFFICES, patch: (data) => setFollowing(data, true) },
];

function seed(client: QueryClient): void {
  client.setQueryData(BY_SLUG, OFFICE);
  client.setQueryData(BY_ID, OFFICE);
  client.setQueryData(LIST, { items: [OTHER, OFFICE], nextCursor: null });
  client.setQueryData(PAGES, {
    pages: [
      { items: [OFFICE], nextCursor: 'next' },
      { items: [OTHER], nextCursor: null },
    ],
    pageParams: [undefined, 'next'],
  });
}

function followingIn(client: QueryClient): boolean[] {
  const pages = client.getQueryData<CachedPages>(PAGES);
  return [
    client.getQueryData<CachedOffice>(BY_SLUG)?.viewer.following,
    client.getQueryData<CachedOffice>(BY_ID)?.viewer.following,
    client.getQueryData<CachedPage>(LIST)?.items[1]?.viewer.following,
    pages?.pages[0]?.items[0]?.viewer.following,
  ].map((each) => each === true);
}

function snapshotOf(client: QueryClient): unknown[] {
  return [BY_SLUG, BY_ID, LIST, PAGES].map((key: QueryKey) => client.getQueryData(key));
}

const failures: OptimisticFailure[] = [];
let unsubscribe: () => void = () => undefined;

beforeEach(() => {
  failures.length = 0;
  unsubscribe = subscribeOptimisticFailures((failure) => failures.push(failure));
});

afterEach(() => {
  unsubscribe();
  queryClientFake.reset();
});

function mount(
  mutationFn: () => Promise<unknown>,
  invalidate: readonly QueryFilters[] = [OFFICES],
) {
  return renderHookWithClient(() =>
    useOptimisticToggle<null>({
      mutationFn,
      action: () => 'follow',
      places: () => PLACES,
      invalidate: () => invalidate,
    }),
  );
}

describe('useOptimisticToggle', () => {
  it('patches every place at once', async () => {
    const hook = mount(() => new Promise<never>(() => undefined));
    seed(hook.client);
    const otherInList = hook.client.getQueryData<CachedPage>(LIST)?.items[0];
    const untouchedPage = hook.client.getQueryData<CachedPages>(PAGES)?.pages[1];

    act(() => {
      hook.result.current.toggle(null);
    });

    await waitFor(() => {
      expect(followingIn(hook.client)).toEqual([true, true, true, true]);
    });
    expect(hook.result.current.pending).toBe(true);
    expect(hook.client.getQueryData<CachedPage>(LIST)?.items[0]).toBe(otherInList);
    expect(hook.client.getQueryData<CachedPages>(PAGES)?.pages[1]?.items).toBe(
      untouchedPage?.items,
    );
    expect(failures).toEqual([]);
  });

  it('puts everything back and reports on failure', async () => {
    const hook = mount(() => Promise.reject(new ApiError('daily_limit_reached')));
    seed(hook.client);
    const before = snapshotOf(hook.client);

    act(() => {
      hook.result.current.toggle(null);
    });

    await waitFor(() => {
      expect(failures).toHaveLength(1);
    });
    expect(snapshotOf(hook.client)).toEqual(before);
    expect(failures[0]).toMatchObject({ action: 'follow', code: 'daily_limit_reached' });
  });

  it('a network failure reports unavailable', async () => {
    const hook = mount(() => Promise.reject(new TypeError('Failed to fetch')));
    seed(hook.client);

    act(() => {
      hook.result.current.toggle(null);
    });

    await waitFor(() => {
      expect(failures).toHaveLength(1);
    });
    expect(failures[0]).toMatchObject({ action: 'follow', code: 'unavailable' });
  });

  it('an offline press rolls back at once', async () => {
    onlineManager.setOnline(false);
    let called = 0;
    const hook = mount(() => {
      called += 1;
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    seed(hook.client);
    const before = snapshotOf(hook.client);

    act(() => {
      hook.result.current.toggle(null);
    });

    await waitFor(() => {
      expect(failures).toHaveLength(1);
    });
    expect(called).toBe(1);
    expect(hook.client.getMutationCache().getAll()[0]?.state.isPaused).toBe(false);
    expect(snapshotOf(hook.client)).toEqual(before);
    expect(failures[0]).toMatchObject({ code: 'unavailable' });
  });

  it('cancels in-flight reads and invalidates on settle', async () => {
    let finish: () => void = () => undefined;
    const hook = mount(
      () =>
        new Promise<unknown>((resolve) => {
          finish = () => {
            resolve({ following: true });
          };
        }),
    );
    seed(hook.client);
    let refetchAborted = false;
    // A refetch of the detail that is still running when the toggle is pressed.
    const refetch = hook.client.query({
      queryKey: BY_SLUG,
      queryFn: ({ signal }) =>
        new Promise<CachedOffice>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            refetchAborted = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
      staleTime: 0,
    });
    // The cancelled read rejects; the test reads the cancellation from the abort signal.
    refetch.catch(() => undefined);
    expect(hook.client.getQueryState(BY_SLUG)?.fetchStatus).toBe('fetching');

    act(() => {
      hook.result.current.toggle(null);
    });

    await waitFor(() => {
      expect(followingIn(hook.client)[0]).toBe(true);
    });
    // The running read was cancelled before the patch, so it cannot write the old value back.
    expect(refetchAborted).toBe(true);
    expect(hook.client.getQueryState(BY_SLUG)?.isInvalidated).toBe(false);

    await act(async () => {
      finish();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(hook.client.getQueryState(BY_SLUG)?.isInvalidated).toBe(true);
    });
    expect(hook.client.getQueryState(LIST)?.isInvalidated).toBe(true);
    expect(failures).toEqual([]);
  });
});
