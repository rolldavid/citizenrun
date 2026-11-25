import * as shared from '@citizenrun/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { phoneClientInfo, resolvePhoneApiOrigin, webClientInfo } from './origin';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';
import type { Session } from './types';

type FixtureConfig = {
  version?: string;
  hostUri?: string;
  extra?: Record<string, unknown>;
};

const constants = vi.hoisted(() => {
  const state: { expoConfig: FixtureConfig | null } = { expoConfig: null };
  return state;
});
const rn = vi.hoisted(() => {
  const Platform: { OS: string } = { OS: 'ios' };
  return { Platform };
});

vi.mock('expo-constants', () => ({ default: constants }));
vi.mock('react-native', () => rn);
vi.mock('@citizenrun/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof shared>();
  return {
    ...actual,
    configureApiClient: vi.fn(actual.configureApiClient),
    brandVariant: vi.fn(actual.brandVariant),
    siteOrigin: vi.fn(actual.siteOrigin),
  };
});

const DEV_HOST_URI = '192.168.1.20:8081';
const DEV_ORIGIN = 'http://192.168.1.20:8080';

type Loaded = { session: Session; api: typeof shared };

async function load(file: 'native' | 'web'): Promise<Loaded> {
  vi.resetModules();
  const session =
    file === 'native'
      ? (await vi.importActual<typeof NativeIndex>('./index.native')).session
      : (await vi.importActual<typeof WebIndex>('./index.web')).session;
  const api = await import('@citizenrun/shared');
  // the mocked package keeps its instance across resetModules; each load starts with no recorded call
  vi.mocked(api.configureApiClient).mockClear();
  return { session, api };
}

function thrown(call: () => unknown): unknown {
  try {
    call();
  } catch (error: unknown) {
    return error;
  }
  return null;
}

function callbacks(): { onUnauthorized: () => void; onUpgradeRequired: () => void } {
  return { onUnauthorized: vi.fn(), onUpgradeRequired: vi.fn() };
}

function respond(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(null, { status }))),
  );
}

async function request(api: typeof shared, init: RequestInit = { method: 'GET' }): Promise<void> {
  try {
    await api.apiFetch('/v1/fixture', init);
  } catch {
    // an error answer throws ApiError; the callbacks are what these cases check
  }
}

function fetchInit(): RequestInit {
  const fetchMock = vi.mocked(globalThis.fetch);
  const init = fetchMock.mock.calls[0]?.[1];
  if (init === undefined) {
    throw new Error('fetch was not called with an init');
  }
  return init;
}

beforeEach(() => {
  rn.Platform.OS = 'ios';
  constants.expoConfig = {
    version: '1.4.0',
    hostUri: DEV_HOST_URI,
    extra: { variant: 'development', apiOrigin: null },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session', () => {
  it('client header', async () => {
    expect(phoneClientInfo('ios', '1.4.0')).toEqual({
      platform: 'ios',
      appVersion: '1.4.0',
      header: 'ios/1.4.0',
    });
    expect(phoneClientInfo('android', '2.0.10')?.header).toBe('android/2.0.10');
    expect(webClientInfo('0.1.0')).toEqual({
      platform: 'web',
      appVersion: '0.1.0',
      header: 'web/0.1.0',
    });
    expect(webClientInfo(undefined)).toEqual({
      platform: 'web',
      appVersion: '0.0.0',
      header: 'web',
    });
    expect(phoneClientInfo('ios', '1.4')).toBeNull();
    expect(phoneClientInfo('ios', '12345.0.0')).toBeNull();

    const ios = await load('native');
    expect(ios.session.client).toEqual({
      platform: 'ios',
      appVersion: '1.4.0',
      header: 'ios/1.4.0',
    });

    rn.Platform.OS = 'android';
    constants.expoConfig = { version: '2.0.10' };
    const android = await load('native');
    expect(android.session.client.header).toBe('android/2.0.10');

    constants.expoConfig = { version: '0.1.0' };
    expect((await load('web')).session.client.header).toBe('web/0.1.0');
    constants.expoConfig = {};
    const bareWeb = (await load('web')).session.client;
    expect(bareWeb).toEqual({ platform: 'web', appVersion: '0.0.0', header: 'web' });

    for (const config of [{}, { version: '1.4' }, null]) {
      constants.expoConfig = config;
      const phone = await load('native');
      expect(thrown(() => phone.session.client)).toMatchObject({
        name: 'PlatformError',
        module: 'session',
        code: 'session.no_version',
      });
    }
  });

  it('api origin order', async () => {
    expect(
      resolvePhoneApiOrigin({
        extraApiOrigin: 'http://api.example.test:9000',
        variant: 'development',
        hostUri: DEV_HOST_URI,
      }),
    ).toBe('http://api.example.test:9000');

    const variants = {
      development: shared.brandVariant('development'),
      staging: shared.brandVariant('staging'),
      production: shared.brandVariant('production'),
    };
    vi.mocked(shared.brandVariant).mockImplementation((name) =>
      name === 'staging' ? { ...variants.staging, host: 'example.test' } : variants[name],
    );
    vi.mocked(shared.siteOrigin).mockImplementation(() => 'https://example.test');
    expect(
      resolvePhoneApiOrigin({ extraApiOrigin: null, variant: 'staging', hostUri: DEV_HOST_URI }),
    ).toBe('https://example.test');
    vi.mocked(shared.siteOrigin).mockRestore();

    // From here no variant has a host, whatever brand.json holds.
    vi.mocked(shared.brandVariant).mockImplementation((name) => ({
      ...variants[name],
      host: null,
      adminHost: null,
    }));

    expect(
      resolvePhoneApiOrigin({
        extraApiOrigin: null,
        variant: 'development',
        hostUri: DEV_HOST_URI,
      }),
    ).toBe(DEV_ORIGIN);
    expect(
      resolvePhoneApiOrigin({
        extraApiOrigin: undefined,
        variant: 'development',
        hostUri: 'exp://localhost:8081/--/x',
      }),
    ).toBe('http://localhost:8080');
    // the evaluated config can carry an unset value as {}
    expect(
      resolvePhoneApiOrigin({ extraApiOrigin: {}, variant: 'development', hostUri: DEV_HOST_URI }),
    ).toBe(DEV_ORIGIN);
    expect(
      resolvePhoneApiOrigin({ extraApiOrigin: '', variant: 'development', hostUri: DEV_HOST_URI }),
    ).toBe(DEV_ORIGIN);
    expect(
      resolvePhoneApiOrigin({ extraApiOrigin: null, variant: 'staging', hostUri: DEV_HOST_URI }),
    ).toBeNull();
    expect(
      resolvePhoneApiOrigin({ extraApiOrigin: null, variant: 'development', hostUri: 'exp://' }),
    ).toBeNull();
    expect(
      resolvePhoneApiOrigin({ extraApiOrigin: null, variant: 'toString', hostUri: DEV_HOST_URI }),
    ).toBeNull();
    expect(
      resolvePhoneApiOrigin({ extraApiOrigin: undefined, variant: undefined, hostUri: undefined }),
    ).toBeNull();

    const phone = await load('native');
    expect(phone.session.apiOrigin).toBe(DEV_ORIGIN);

    constants.expoConfig = {
      version: '1.4.0',
      extra: { apiOrigin: 'http://api.example.test:9000' },
    };
    expect((await load('native')).session.apiOrigin).toBe('http://api.example.test:9000');

    constants.expoConfig = { version: '1.4.0' };
    const nowhere = await load('native');
    expect(thrown(() => nowhere.session.apiOrigin)).toMatchObject({
      name: 'PlatformError',
      module: 'session',
      code: 'session.no_origin',
    });
    vi.mocked(shared.brandVariant).mockRestore();
  });

  it('the web origin is empty', async () => {
    const web = await load('web');
    expect(web.session.apiOrigin).toBe('');
    expect(web.session.credential).toBe('cookie');
    expect((await load('native')).session.credential).toBe('bearer');
  });

  it('configure', async () => {
    const phone = await load('native');
    const first = callbacks();
    phone.session.configure(first);
    const configure = vi.mocked(phone.api.configureApiClient);
    expect(configure).toHaveBeenCalledTimes(1);
    const options = configure.mock.calls[0]?.[0];
    expect(options).toMatchObject({
      origin: DEV_ORIGIN,
      clientHeader: 'ios/1.4.0',
      credentials: 'omit',
    });
    expect(options?.getAuthorization()).toBeNull();

    respond(200);
    await request(phone.api);
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toBe(`${DEV_ORIGIN}/v1/fixture`);
    const headers = new Headers(fetchInit().headers);
    expect(headers.get('X-OS-Client')).toBe('ios/1.4.0');
    expect(headers.has('Authorization')).toBe(false);

    respond(401);
    await request(phone.api);
    expect(first.onUnauthorized).toHaveBeenCalledTimes(1);
    respond(426);
    await request(phone.api);
    expect(first.onUpgradeRequired).toHaveBeenCalledTimes(1);

    const second = callbacks();
    phone.session.configure(second);
    expect(configure).toHaveBeenCalledTimes(1);
    respond(401);
    await request(phone.api);
    expect(second.onUnauthorized).toHaveBeenCalledTimes(1);
    expect(first.onUnauthorized).toHaveBeenCalledTimes(1);

    constants.expoConfig = { version: '0.1.0' };
    const web = await load('web');
    const webCallbacks = callbacks();
    web.session.configure(webCallbacks);
    const webConfigure = vi.mocked(web.api.configureApiClient);
    expect(webConfigure).toHaveBeenCalledTimes(1);
    const webOptions = webConfigure.mock.calls[0]?.[0];
    expect(webOptions).toMatchObject({
      origin: '',
      clientHeader: 'web/0.1.0',
      credentials: 'same-origin',
    });
    expect(webOptions?.getAuthorization()).toBeNull();
    respond(401);
    await request(web.api);
    expect(webCallbacks.onUnauthorized).toHaveBeenCalledTimes(1);
    respond(426);
    await request(web.api);
    expect(webCallbacks.onUpgradeRequired).toHaveBeenCalledTimes(1);
    web.session.configure(callbacks());
    expect(webConfigure).toHaveBeenCalledTimes(1);
  });

  it('keepalive', async () => {
    const web = await load('web');
    web.session.configure(callbacks());
    respond(204);
    await web.api.apiFetch('/v1/fixture', { method: 'POST', keepalive: true });
    expect(vi.mocked(globalThis.fetch).mock.calls[0]?.[0]).toBe('/v1/fixture');
    expect(fetchInit()).toMatchObject({ keepalive: true, credentials: 'same-origin' });
  });
});
