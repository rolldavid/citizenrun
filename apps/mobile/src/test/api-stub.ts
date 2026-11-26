import { configureApiClient } from '@citizenrun/shared';
import type { ErrorCode } from '@citizenrun/shared';
import { vi } from 'vitest';

export const TEST_API_ORIGIN = 'http://api.test';
export type StubMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type RecordedRequest = {
  method: StubMethod;
  path: string;
  query: Readonly<Record<string, string>>;
  body: unknown;
  hasSignal: boolean;
};
export type StubReply =
  | { kind: 'json'; status: number; body: unknown; headers: Readonly<Record<string, string>> }
  | { kind: 'empty'; status: number }
  | { kind: 'network_error' }
  | { kind: 'hang' };
export type StubRoute = {
  method: StubMethod;
  path: string;
  reply: StubReply | ((request: RecordedRequest, callIndex: number) => StubReply);
};
export type ApiStub = {
  readonly requests: RecordedRequest[];
  use(routes: readonly StubRoute[]): void;
};

/** A JSON answer. */
export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): StubReply {
  return { kind: 'json', status, body, headers };
}

/** The API's error envelope, with `Retry-After` when given. */
export function apiError(
  status: number,
  code: ErrorCode,
  options: { fields?: Record<string, string>; retryAfterSeconds?: number } = {},
): StubReply {
  const headers: Record<string, string> =
    options.retryAfterSeconds === undefined
      ? {}
      : { 'Retry-After': String(options.retryAfterSeconds) };
  return json(status, { error: { code, message: 'test', fields: options.fields ?? {} } }, headers);
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (input instanceof Request) return input.url;
  return String(input);
}

function methodOf(input: unknown, init: RequestInit | undefined): StubMethod {
  const raw = init?.method ?? (input instanceof Request ? input.method : 'GET');
  return raw.toUpperCase() as StubMethod; // the mutator sends only the methods of the generated client
}

function bodyOf(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (typeof body !== 'string') return null;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function abortError(): DOMException {
  return new DOMException('The request was aborted.', 'AbortError');
}

function respond(reply: StubReply, signal: AbortSignal | null): Promise<Response> {
  switch (reply.kind) {
    case 'json':
      return Promise.resolve(
        new Response(JSON.stringify(reply.body), {
          status: reply.status,
          headers: { 'Content-Type': 'application/json', ...reply.headers },
        }),
      );
    case 'empty':
      return Promise.resolve(new Response(null, { status: reply.status }));
    case 'network_error':
      return Promise.reject(new TypeError('Failed to fetch'));
    case 'hang':
      return new Promise<Response>((_resolve, reject) => {
        if (signal === null) return;
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        signal.addEventListener('abort', () => {
          reject(abortError());
        });
      });
  }
}

/** Replaces fetch: records every request and answers by the first route whose method and path match. */
export function installApiStub(routes: readonly StubRoute[]): ApiStub {
  let current = routes;
  const counts = new Map<StubRoute, number>();
  const requests: RecordedRequest[] = [];

  const fake = (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = new URL(urlOf(input), TEST_API_ORIGIN);
    const signal = init?.signal ?? null;
    const recorded: RecordedRequest = {
      method: methodOf(input, init),
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      body: bodyOf(init),
      hasSignal: signal !== null,
    };
    requests.push(recorded);
    const route = current.find(
      (candidate) => candidate.method === recorded.method && candidate.path === recorded.path,
    );
    if (route === undefined) {
      return Promise.reject(new Error(`no stub for ${recorded.method} ${recorded.path}`));
    }
    const callIndex = counts.get(route) ?? 0;
    counts.set(route, callIndex + 1);
    const reply =
      typeof route.reply === 'function' ? route.reply(recorded, callIndex) : route.reply;
    return respond(reply, signal);
  };

  vi.stubGlobal('fetch', vi.fn(fake));
  return {
    requests,
    use: (next) => {
      current = next;
      counts.clear();
    },
  };
}

/** Points the generated client at the stub, with no-op callbacks unless given. */
export function configureTestApiClient(
  callbacks: { onUnauthorized?: () => void; onUpgradeRequired?: () => void } = {},
): void {
  configureApiClient({
    origin: TEST_API_ORIGIN,
    clientHeader: 'web/1.0.0',
    getAuthorization: () => null,
    credentials: 'same-origin',
    onUnauthorized: callbacks.onUnauthorized ?? noop,
    onUpgradeRequired: callbacks.onUpgradeRequired ?? noop,
  });
}

function noop(): void {
  // nothing to do
}
