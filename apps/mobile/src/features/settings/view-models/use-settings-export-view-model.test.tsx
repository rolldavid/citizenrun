import type { DataExportStatus, Me } from '@citizenrun/shared';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { writeMeToCache } from '@/features/system';
import { resetNavigationState } from '@/lib/navigation';
import { resetSessionPresence } from '@/lib/session-state';
import { fixtureMe, fixtureSessionInfo } from '@/lib/view-models/__fixtures__/common';
import { queryClient } from '@/platform/query-client';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub, StubReply, StubRoute } from '@/test/api-stub';
import { linksFake } from '@/test/platform/links';
import { queryClientFake } from '@/test/platform/query-client';
import { renderHookWithClient } from '@/test/render-hook';

import type { SettingsExportViewModel } from './settings-export.types';
import { useSettingsExportViewModel } from './use-settings-export-view-model';

// The system feature's index loads its screens: the web builds of these two libraries, as its own tests use.
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a drawing of the app loads no asset');
  },
}));
vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

const NOW = new Date('2027-01-15T12:00:00.000Z');
const EXPORT_ID = '01890000-0000-7000-8000-0000000000e1';
const NONE: DataExportStatus = { export: null, nextRequestAt: null };
const QUEUED_VIEW = {
  id: EXPORT_ID,
  status: 'queued',
  requestedAt: '2027-01-15T12:00:00.000Z',
  readyAt: null,
  expiresAt: null,
} as const;
const QUEUED: DataExportStatus = {
  export: QUEUED_VIEW,
  nextRequestAt: '2027-01-16T12:00:00.000Z',
};
const READY: DataExportStatus = {
  export: {
    ...QUEUED_VIEW,
    status: 'ready',
    readyAt: '2027-01-15T12:04:00.000Z',
    expiresAt: '2027-01-16T12:04:00.000Z',
  },
  nextRequestAt: '2027-01-16T12:00:00.000Z',
};
const DOWNLOAD = {
  url: 'https://store.example.test/exports/fixture.json?signature=fixture',
  expiresAt: '2027-01-15T12:05:00.000Z',
};

let stub: ApiStub;

function minutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function meSignedIn(minutesLeft: number): Me {
  return fixtureMe({
    session: {
      platform: 'ios',
      authenticatedAt: minutesFromNow(minutesLeft - 15),
      expiresAt: '2027-04-15T12:00:00.000Z',
      sensitiveActionsUntil: minutesFromNow(minutesLeft),
    },
  });
}

/** The status route answers each GET in turn, the last answer repeating. */
function statusRoute(answers: readonly DataExportStatus[]): StubRoute {
  return {
    method: 'GET',
    path: '/v1/me/export',
    reply: (_request, index) => json(200, answers[Math.min(index, answers.length - 1)]),
  };
}

function reauthRoutes(): StubRoute[] {
  return [
    {
      method: 'POST',
      path: '/v1/auth/nonce',
      reply: () =>
        json(200, {
          nonce: 'n'.repeat(43),
          nonceHash: 'fixture-hash',
          state: 's'.repeat(43),
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        }),
    },
    {
      method: 'POST',
      path: '/v1/auth/email/start',
      reply: json(200, {
        pendingToken: 'p'.repeat(43),
        expiresAt: '2027-01-15T12:10:00.000Z',
        resendAvailableAt: '2027-01-15T12:00:30.000Z',
      }),
    },
    {
      method: 'POST',
      path: '/v1/auth/email/verify',
      reply: json(200, fixtureSessionInfo({ me: meSignedIn(15) })),
    },
  ];
}

function answer(routes: StubRoute[]): void {
  stub.use([...routes, ...reauthRoutes()]);
}

function postRoute(reply: StubReply): StubRoute {
  return { method: 'POST', path: '/v1/me/export', reply };
}

function downloadRoute(reply: StubReply): StubRoute {
  return { method: 'GET', path: '/v1/me/export/download', reply };
}

/** Moves the fake clock (Date and the polling interval), then lets the answers and the query's notifications arrive. */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await act(async () => {
    for (let round = 0; round < 10; round += 1) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

async function render(me: Me) {
  writeMeToCache(queryClient.get(), me);
  const hook = renderHookWithClient(() => useSettingsExportViewModel());
  await advance(0);
  return hook;
}

function readyData(vm: SettingsExportViewModel) {
  if (vm.status !== 'ready') throw new Error(`expected ready, got ${vm.status}`);
  return vm.data;
}

function requestsTo(method: string, path: string) {
  return stub.requests.filter((request) => request.method === method && request.path === path);
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setInterval', 'clearInterval', 'Date'],
  });
  vi.setSystemTime(NOW);
  stub = installApiStub([]);
  configureTestApiClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetNavigationState();
  resetSessionPresence();
});

describe('useSettingsExportViewModel', () => {
  it('requests an export after a recent sign-in', async () => {
    answer([statusRoute([NONE, QUEUED]), postRoute(json(202, QUEUED_VIEW))]);
    const hook = await render(meSignedIn(1));
    expect(readyData(hook.result.current).status).toEqual(NONE);

    act(() => {
      readyData(hook.result.current).onRequest();
    });
    expect(readyData(hook.result.current).requesting).toBe(true);
    await advance(0);

    expect(requestsTo('POST', '/v1/me/export').map((request) => request.body)).toEqual([{}]);
    expect(requestsTo('GET', '/v1/me/export')).toHaveLength(2);
    expect(readyData(hook.result.current)).toMatchObject({
      status: QUEUED,
      requesting: false,
      errorCode: null,
    });
    expect(readyData(hook.result.current).reauth.open).toBe(false);
  });

  it('opens the sheet first after an old sign-in', async () => {
    answer([statusRoute([NONE, QUEUED]), postRoute(json(202, QUEUED_VIEW))]);
    const hook = await render(meSignedIn(-1));

    act(() => {
      readyData(hook.result.current).onRequest();
    });
    await advance(0);
    expect(requestsTo('POST', '/v1/me/export')).toEqual([]);
    expect(readyData(hook.result.current).reauth.open).toBe(true);

    act(() => {
      readyData(hook.result.current).reauth.onSendCode();
    });
    await advance(0);
    act(() => {
      readyData(hook.result.current).reauth.code?.onSubmit('123456');
    });
    await advance(0);

    expect(requestsTo('POST', '/v1/auth/email/verify')).toHaveLength(1);
    expect(requestsTo('POST', '/v1/me/export')).toHaveLength(1);
    expect(readyData(hook.result.current).reauth.open).toBe(false);
    await advance(1_000);
    expect(requestsTo('POST', '/v1/me/export')).toHaveLength(1);
  });

  it('opens the sheet when the server asks', async () => {
    answer([statusRoute([NONE]), postRoute(apiError(403, 'recent_sign_in_required'))]);
    const hook = await render(meSignedIn(1));

    act(() => {
      readyData(hook.result.current).onRequest();
    });
    await advance(0);
    expect(requestsTo('POST', '/v1/me/export')).toHaveLength(1);
    expect(readyData(hook.result.current).reauth.open).toBe(true);
    expect(readyData(hook.result.current).errorCode).toBeNull();
    expect(readyData(hook.result.current).requesting).toBe(false);
  });

  it('polls while the file is being built', async () => {
    answer([statusRoute([QUEUED, READY])]);
    const hook = await render(meSignedIn(1));
    expect(requestsTo('GET', '/v1/me/export')).toHaveLength(1);

    await advance(9_999);
    expect(requestsTo('GET', '/v1/me/export')).toHaveLength(1);
    await advance(1);
    expect(requestsTo('GET', '/v1/me/export')).toHaveLength(2);
    expect(readyData(hook.result.current).status).toEqual(READY);

    await advance(60_000);
    expect(requestsTo('GET', '/v1/me/export')).toHaveLength(2);
  });

  it('shows the wait after a second request in a day', async () => {
    answer([
      statusRoute([NONE, QUEUED]),
      postRoute(apiError(429, 'daily_limit_reached', { retryAfterSeconds: 86_000 })),
    ]);
    const hook = await render(meSignedIn(1));

    act(() => {
      readyData(hook.result.current).onRequest();
    });
    await advance(0);
    expect(readyData(hook.result.current).errorCode).toBe('daily_limit_reached');
    expect(requestsTo('GET', '/v1/me/export')).toHaveLength(2);
    expect(readyData(hook.result.current).status.nextRequestAt).toBe(QUEUED.nextRequestAt);
  });

  it('opens the download link the API just issued', async () => {
    answer([statusRoute([READY]), downloadRoute(json(200, DOWNLOAD))]);
    const hook = await render(meSignedIn(1));

    act(() => {
      readyData(hook.result.current).onDownload();
    });
    expect(readyData(hook.result.current).downloading).toBe(true);
    await advance(0);

    expect(requestsTo('GET', '/v1/me/export/download')).toHaveLength(1);
    expect(linksFake.calls).toEqual([{ op: 'openIssuedUrl' }]);
    expect(readyData(hook.result.current)).toMatchObject({ downloading: false, errorCode: null });
    expect(
      JSON.stringify(
        queryClient
          .get()
          .getQueryCache()
          .getAll()
          .map((q) => q.state.data),
      ),
    ).not.toContain(DOWNLOAD.url);
  });

  it('reports a link the device could not open', async () => {
    answer([statusRoute([READY]), downloadRoute(json(200, DOWNLOAD))]);
    linksFake.scriptIssuedUrl('failed');
    const hook = await render(meSignedIn(1));

    act(() => {
      readyData(hook.result.current).onDownload();
    });
    await advance(0);
    expect(readyData(hook.result.current).errorCode).toBe('generic');
  });

  it('refetches when the file is not ready', async () => {
    answer([statusRoute([READY, QUEUED]), downloadRoute(apiError(409, 'export_not_ready'))]);
    const hook = await render(meSignedIn(1));

    act(() => {
      readyData(hook.result.current).onDownload();
    });
    await advance(0);
    expect(readyData(hook.result.current).errorCode).toBe('export_not_ready');
    expect(requestsTo('GET', '/v1/me/export')).toHaveLength(2);
    expect(readyData(hook.result.current).status).toEqual(QUEUED);
    expect(linksFake.calls).toEqual([]);
  });

  it('opens the sheet when the server asks for a fresh sign-in before a download', async () => {
    answer([statusRoute([READY]), downloadRoute(apiError(403, 'recent_sign_in_required'))]);
    const hook = await render(meSignedIn(1));

    act(() => {
      readyData(hook.result.current).onDownload();
    });
    await advance(0);
    expect(readyData(hook.result.current).reauth.open).toBe(true);
    expect(linksFake.calls).toEqual([]);
  });

  it('sends nothing while offline', async () => {
    answer([
      statusRoute([READY]),
      postRoute(json(202, QUEUED_VIEW)),
      downloadRoute(json(200, DOWNLOAD)),
    ]);
    const hook = await render(meSignedIn(1));
    act(() => {
      queryClientFake.setOnline(false);
    });
    expect(hook.result.current).toMatchObject({ status: 'ready', stale: true });

    act(() => {
      readyData(hook.result.current).onRequest();
      readyData(hook.result.current).onDownload();
    });
    await advance(0);
    expect(requestsTo('POST', '/v1/me/export')).toEqual([]);
    expect(requestsTo('GET', '/v1/me/export/download')).toEqual([]);
    expect(readyData(hook.result.current).reauth.open).toBe(false);
  });
});
