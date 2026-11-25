import * as shared from '@citizenrun/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { auth } from '@/platform/auth';
import { queryClient } from '@/platform/query-client';
import { PlatformNotReadyError } from '@/platform/shared';
import { storage } from '@/platform/storage';
import { authFake } from '@/test/platform/auth';
import { queryClientFake } from '@/test/platform/query-client';
import { storageFake } from '@/test/platform/storage';

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

// expo-secure-store as an in-memory map. Every call records its options; a count of failures makes the next
// calls of one kind throw.
type StoreOptions = { keychainAccessible?: number };
const secure = vi.hoisted(() => {
  const AFTER_FIRST_UNLOCK = 7; // a fixture value: the real constant comes from the native module
  const values = new Map<string, string>();
  const failures = { get: 0, set: 0, delete: 0 };
  function fail(kind: 'get' | 'set' | 'delete'): void {
    if (failures[kind] > 0) {
      failures[kind] -= 1;
      throw new Error('fixture keychain failure');
    }
  }
  return {
    AFTER_FIRST_UNLOCK,
    values,
    failures,
    getItemAsync: vi.fn((key: string, _options?: StoreOptions): Promise<string | null> => {
      fail('get');
      return Promise.resolve(values.get(key) ?? null);
    }),
    setItemAsync: vi.fn((key: string, value: string, _options?: StoreOptions): Promise<void> => {
      fail('set');
      values.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: vi.fn((key: string, _options?: StoreOptions): Promise<void> => {
      fail('delete');
      values.delete(key);
      return Promise.resolve();
    }),
  };
});

// expo-file-system's File over an in-memory set of names in the document directory.
const fs = vi.hoisted(() => ({ files: new Set<string>(), created: [] as string[] }));

vi.mock('expo-constants', () => ({ default: constants }));
vi.mock('react-native', () => rn);
vi.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK: secure.AFTER_FIRST_UNLOCK,
  getItemAsync: secure.getItemAsync,
  setItemAsync: secure.setItemAsync,
  deleteItemAsync: secure.deleteItemAsync,
}));
vi.mock('expo-file-system', () => {
  class File {
    private readonly name: string;
    constructor(_directory: unknown, name: string) {
      this.name = name;
    }
    get exists(): boolean {
      return fs.files.has(this.name);
    }
    create(): void {
      fs.created.push(this.name);
      fs.files.add(this.name);
    }
  }
  return { File, Paths: { document: { uri: 'fixture-document-directory' } } };
});
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

const TOKEN_KEY = 'session.token';
const MARKER = 'session-install-v1';
const STORE_OPTIONS = { keychainAccessible: secure.AFTER_FIRST_UNLOCK };
// 43 characters of the token alphabet; a fixture, never a real token
const TOKEN = 'fixtureToken-' + 'x'.repeat(30);
const NEXT_TOKEN = 'fixtureToken_' + 'y'.repeat(30);
const EXPIRES_AT = '2026-12-25T00:00:00.000Z';

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
let consoleSpies: MockInstance[] = [];

beforeEach(() => {
  secure.values.clear();
  secure.failures.get = 0;
  secure.failures.set = 0;
  secure.failures.delete = 0;
  secure.getItemAsync.mockClear();
  secure.setItemAsync.mockClear();
  secure.deleteItemAsync.mockClear();
  fs.files = new Set([MARKER]);
  fs.created = [];
  consoleSpies = CONSOLE_METHODS.map((method) => vi.spyOn(console, method));
  rn.Platform.OS = 'ios';
  constants.expoConfig = {
    version: '1.4.0',
    hostUri: DEV_HOST_URI,
    extra: { variant: 'development', apiOrigin: null },
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  // nothing is logged, in any case of this file
  const logged = consoleSpies.filter((spy) => spy.mock.calls.length > 0).length;
  vi.restoreAllMocks();
  expect(logged).toBe(0);
});

/** The configured mutator's getAuthorization, after configure on a freshly loaded file. */
function authorizationOf(loaded: Loaded): () => string | null {
  loaded.session.configure(callbacks());
  const options = vi.mocked(loaded.api.configureApiClient).mock.calls[0]?.[0];
  if (options === undefined) {
    throw new Error('configureApiClient was not called');
  }
  return options.getAuthorization;
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  return null;
}

function callOrder(spy: MockInstance): number {
  const order = spy.mock.invocationCallOrder[0];
  if (order === undefined) {
    throw new Error('the step was not called');
  }
  return order;
}

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

describe('session tokens', () => {
  it('configure (extended)', async () => {
    const phone = await load('native');
    const getAuthorization = authorizationOf(phone);
    expect(getAuthorization()).toBeNull();
    await phone.session.adopt({ token: TOKEN, expiresAt: EXPIRES_AT });
    expect(getAuthorization()).toBe('Bearer ' + TOKEN);

    respond(200);
    await request(phone.api);
    expect(new Headers(fetchInit().headers).get('Authorization')).toBe('Bearer ' + TOKEN);
  });

  it('token storage', async () => {
    const first = await load('native');
    await first.session.adopt({ token: TOKEN, expiresAt: EXPIRES_AT });
    expect(secure.setItemAsync).toHaveBeenCalledTimes(1);
    expect(secure.setItemAsync).toHaveBeenCalledWith(TOKEN_KEY, TOKEN, STORE_OPTIONS);

    const fresh = await load('native');
    const getAuthorization = authorizationOf(fresh);
    expect(getAuthorization()).toBeNull();
    expect(await fresh.session.hydrate()).toBe('present');
    expect(secure.getItemAsync).toHaveBeenCalledWith(TOKEN_KEY, STORE_OPTIONS);
    expect(getAuthorization()).toBe('Bearer ' + TOKEN);
    expect(secure.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('a missing token is absent', async () => {
    const phone = await load('native');
    const getAuthorization = authorizationOf(phone);
    expect(await phone.session.hydrate()).toBe('absent');
    expect(getAuthorization()).toBeNull();
    expect(secure.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('a malformed token is cleared', async () => {
    for (const malformed of ['abc', TOKEN + 'z', TOKEN.slice(1) + '.', '']) {
      secure.values.set(TOKEN_KEY, malformed);
      secure.deleteItemAsync.mockClear();
      const phone = await load('native');
      const getAuthorization = authorizationOf(phone);
      expect(await phone.session.hydrate()).toBe('absent');
      expect(secure.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY, STORE_OPTIONS);
      expect(secure.values.has(TOKEN_KEY)).toBe(false);
      expect(getAuthorization()).toBeNull();
    }

    // a delete that fails still answers absent
    secure.values.set(TOKEN_KEY, 'abc');
    secure.failures.delete = 1;
    await expect((await load('native')).session.hydrate()).resolves.toBe('absent');
  });

  it('a read error is absent', async () => {
    secure.values.set(TOKEN_KEY, TOKEN);
    secure.failures.get = 1;
    const phone = await load('native');
    const getAuthorization = authorizationOf(phone);
    await expect(phone.session.hydrate()).resolves.toBe('absent');
    expect(getAuthorization()).toBeNull();
  });

  it('adopt refuses a malformed token', async () => {
    const phone = await load('native');
    const getAuthorization = authorizationOf(phone);
    for (const malformed of ['short', TOKEN + 'z', TOKEN.slice(1) + '/', TOKEN.slice(1) + ' ']) {
      const error = await rejection(
        phone.session.adopt({ token: malformed, expiresAt: EXPIRES_AT }),
      );
      expect(error).toMatchObject({
        name: 'PlatformError',
        module: 'session',
        code: 'session.store_failed',
        message: 'session.store_failed',
      });
    }
    expect(secure.setItemAsync).not.toHaveBeenCalled();
    expect(secure.values.size).toBe(0);
    expect(getAuthorization()).toBeNull();
  });

  it('adopt keeps the old state on a store failure', async () => {
    const phone = await load('native');
    const getAuthorization = authorizationOf(phone);
    await phone.session.adopt({ token: TOKEN, expiresAt: EXPIRES_AT });

    secure.failures.set = 1;
    const error = await rejection(
      phone.session.adopt({ token: NEXT_TOKEN, expiresAt: EXPIRES_AT }),
    );
    expect(error).toMatchObject({ name: 'PlatformError', code: 'session.store_failed' });
    // the library's own error never leaves the module
    expect(String(error)).not.toContain('fixture keychain failure');
    expect(getAuthorization()).toBe('Bearer ' + TOKEN);
    expect(secure.values.get(TOKEN_KEY)).toBe(TOKEN);

    // with nothing adopted before, a failure leaves no token
    const fresh = await load('native');
    const freshAuthorization = authorizationOf(fresh);
    secure.failures.set = 1;
    expect(
      await rejection(fresh.session.adopt({ token: NEXT_TOKEN, expiresAt: EXPIRES_AT })),
    ).toMatchObject({ code: 'session.store_failed' });
    expect(freshAuthorization()).toBeNull();
  });

  it('adopt with no token', async () => {
    const phone = await load('native');
    const getAuthorization = authorizationOf(phone);
    await phone.session.adopt({ token: TOKEN, expiresAt: EXPIRES_AT });
    secure.setItemAsync.mockClear();

    await expect(
      phone.session.adopt({ token: null, expiresAt: EXPIRES_AT }),
    ).resolves.toBeUndefined();
    expect(secure.setItemAsync).not.toHaveBeenCalled();
    expect(secure.deleteItemAsync).not.toHaveBeenCalled();
    expect(getAuthorization()).toBe('Bearer ' + TOKEN);
  });

  it('reinstall', async () => {
    fs.files = new Set();
    secure.values.set(TOKEN_KEY, TOKEN);
    const phone = await load('native');
    const getAuthorization = authorizationOf(phone);

    expect(await phone.session.hydrate()).toBe('absent');
    expect(secure.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY, STORE_OPTIONS);
    expect(secure.values.has(TOKEN_KEY)).toBe(false);
    expect(fs.created).toEqual([MARKER]);
    expect(getAuthorization()).toBeNull();

    // the next start finds the marker and keeps a token adopted since
    await phone.session.adopt({ token: TOKEN, expiresAt: EXPIRES_AT });
    secure.deleteItemAsync.mockClear();
    expect(await (await load('native')).session.hydrate()).toBe('present');
    expect(secure.deleteItemAsync).not.toHaveBeenCalled();
    expect(fs.created).toEqual([MARKER]);
  });

  it('marker present keeps the token', async () => {
    secure.values.set(TOKEN_KEY, TOKEN);
    const phone = await load('native');
    expect(await phone.session.hydrate()).toBe('present');
    expect(secure.deleteItemAsync).not.toHaveBeenCalled();
    expect(fs.created).toEqual([]);
  });

  it('endLocal clears in order', async () => {
    const phone = await load('native');
    const getAuthorization = authorizationOf(phone);
    await phone.session.adopt({ token: TOKEN, expiresAt: EXPIRES_AT });
    const clearUserData = vi.spyOn(storage, 'clearUserData');
    const clear = vi.spyOn(queryClient, 'clear');
    const clearProviderState = vi.spyOn(auth, 'clearProviderState');
    secure.failures.delete = 2;

    await expect(phone.session.endLocal('logout')).resolves.toBeUndefined();

    expect(getAuthorization()).toBeNull();
    expect(secure.deleteItemAsync).toHaveBeenCalledTimes(2);
    expect(secure.deleteItemAsync).toHaveBeenCalledWith(TOKEN_KEY, STORE_OPTIONS);
    expect(storageFake.calls).toEqual([{ op: 'clearUserData' }]);
    expect(queryClientFake.calls).toEqual([{ op: 'clear' }]);
    expect(authFake.calls).toEqual([{ op: 'clearProviderState' }]);
    const deleteOrder = secure.deleteItemAsync.mock.invocationCallOrder;
    expect(deleteOrder.every((order) => order < callOrder(clearUserData))).toBe(true);
    expect(callOrder(clearUserData)).toBeLessThan(callOrder(clear));
    expect(callOrder(clear)).toBeLessThan(callOrder(clearProviderState));

    // a delete that works the first time is not repeated
    secure.deleteItemAsync.mockClear();
    await phone.session.endLocal('unauthorized');
    expect(secure.deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it('endLocal survives a failing step', async () => {
    const phone = await load('native');
    const getAuthorization = authorizationOf(phone);
    await phone.session.adopt({ token: TOKEN, expiresAt: EXPIRES_AT });
    vi.spyOn(storage, 'clearUserData').mockImplementation(() => {
      throw new Error('fixture storage failure');
    });

    await expect(phone.session.endLocal('account_deleted')).resolves.toBeUndefined();
    expect(getAuthorization()).toBeNull();
    expect(secure.values.has(TOKEN_KEY)).toBe(false);
    expect(queryClientFake.calls).toEqual([{ op: 'clear' }]);
    expect(authFake.calls).toEqual([{ op: 'clearProviderState' }]);

    // the query cache failing, and provider state rejecting as the sign-in stub does, end nothing early
    vi.spyOn(queryClient, 'clear').mockImplementation(() => {
      throw new Error('fixture cache failure');
    });
    const clearProviderState = vi
      .spyOn(auth, 'clearProviderState')
      .mockRejectedValue(new PlatformNotReadyError('auth', 'clearProviderState'));
    secure.failures.delete = 2;
    await expect(phone.session.endLocal('account_minor')).resolves.toBeUndefined();
    expect(clearProviderState).toHaveBeenCalledTimes(1);
  });

  it('nothing is logged', async () => {
    // Every path of the phone file once more, the failing ones included.
    fs.files = new Set();
    secure.values.set(TOKEN_KEY, 'abc');
    const phone = await load('native');
    phone.session.configure(callbacks());
    await phone.session.hydrate();
    secure.values.set(TOKEN_KEY, 'abc');
    await phone.session.hydrate();
    secure.failures.get = 1;
    await phone.session.hydrate();
    await rejection(phone.session.adopt({ token: 'short', expiresAt: EXPIRES_AT }));
    secure.failures.set = 1;
    await rejection(phone.session.adopt({ token: TOKEN, expiresAt: EXPIRES_AT }));
    await phone.session.adopt({ token: TOKEN, expiresAt: EXPIRES_AT });
    await phone.session.adopt({ token: null, expiresAt: EXPIRES_AT });
    secure.failures.delete = 2;
    vi.spyOn(storage, 'clearUserData').mockImplementation(() => {
      throw new Error('fixture storage failure');
    });
    vi.spyOn(auth, 'clearProviderState').mockRejectedValue(
      new PlatformNotReadyError('auth', 'clearProviderState'),
    );
    await phone.session.endLocal('logout_all');
    for (const spy of consoleSpies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
