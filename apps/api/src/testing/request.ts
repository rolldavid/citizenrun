import type { ApiEnv } from '../env.ts';

export type TestAuth = { kind: 'bearer'; token: string } | { kind: 'cookie'; token: string };

export type TestRequestOptions = {
  auth?: TestAuth | null; // default null: logged out
  body?: unknown; // JSON
  query?: Record<string, string>;
  headers?: Record<string, string>;
  client?: string | null; // X-OS-Client; default 'ios/1.4.0' with bearer or none, 'web/1.4.0' with cookie; null omits it
  origin?: string | null; // Origin on cookie requests; default PUBLIC_URL; null omits it
  ip?: string; // value of x-real-ip
};

export type TestResponse = {
  status: number;
  headers: Headers;
  json<T = unknown>(): Promise<T>;
  text(): Promise<string>;
};

export type TestClient = {
  get(path: string, o?: TestRequestOptions): Promise<TestResponse>;
  post(path: string, o?: TestRequestOptions): Promise<TestResponse>;
  put(path: string, o?: TestRequestOptions): Promise<TestResponse>;
  patch(path: string, o?: TestRequestOptions): Promise<TestResponse>;
  delete(path: string, o?: TestRequestOptions): Promise<TestResponse>;
};

/** What the client needs of an app: Hono's in-process `request`. */
export type RequestableApp = {
  request(input: string, init?: RequestInit): Response | Promise<Response>;
};

// TEST-NET-3 (RFC 5737): never a real caller.
const DEFAULT_TEST_IP = '203.0.113.10';
const DEFAULT_PHONE_CLIENT = 'ios/1.4.0';
const DEFAULT_WEB_CLIENT = 'web/1.4.0';

function sessionCookieName(env: ApiEnv): string {
  return new URL(env.PUBLIC_URL).protocol === 'https:' ? '__Host-os_session' : 'os_session';
}

function requestHeaders(env: ApiEnv, options: TestRequestOptions): Headers {
  const headers = new Headers();
  const auth = options.auth ?? null;
  const isCookie = auth?.kind === 'cookie';

  const client =
    options.client === undefined
      ? isCookie
        ? DEFAULT_WEB_CLIENT
        : DEFAULT_PHONE_CLIENT
      : options.client;
  if (client !== null) {
    headers.set('X-OS-Client', client);
  }

  const origin = options.origin === undefined ? (isCookie ? env.PUBLIC_URL : null) : options.origin;
  if (origin !== null) {
    headers.set('Origin', origin);
  }

  if (auth?.kind === 'bearer') {
    headers.set('Authorization', `Bearer ${auth.token}`);
  } else if (auth?.kind === 'cookie') {
    headers.set('Cookie', `${sessionCookieName(env)}=${auth.token}`);
  }

  headers.set('x-real-ip', options.ip ?? DEFAULT_TEST_IP);
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
  }
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    headers.set(name, value);
  }
  return headers;
}

function toTestResponse(response: Response): TestResponse {
  return {
    status: response.status,
    headers: response.headers,
    json: async <T = unknown>(): Promise<T> => {
      const parsed: unknown = await response.json();
      return parsed as T; // the caller names the shape it expects; tests parse it where it matters
    },
    text: () => response.text(),
  };
}

/**
 * The in-process client of a test app (TEST-harness-app): requests go through `app.request()` on
 * `PUBLIC_URL`'s origin, with no port. `beforeRequest` runs before each request (the test app resets
 * its statement count there).
 */
export function createTestClient(
  app: RequestableApp,
  env: ApiEnv,
  hooks: { beforeRequest?: () => void } = {},
): TestClient {
  const send = async (
    method: string,
    path: string,
    options: TestRequestOptions = {},
  ): Promise<TestResponse> => {
    const url = new URL(path, env.PUBLIC_URL);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      url.searchParams.set(name, value);
    }
    const init: RequestInit = { method, headers: requestHeaders(env, options) };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    hooks.beforeRequest?.();
    return toTestResponse(await app.request(url.toString(), init));
  };
  return {
    get: (path, options) => send('GET', path, options),
    post: (path, options) => send('POST', path, options),
    put: (path, options) => send('PUT', path, options),
    patch: (path, options) => send('PATCH', path, options),
    delete: (path, options) => send('DELETE', path, options),
  };
}
