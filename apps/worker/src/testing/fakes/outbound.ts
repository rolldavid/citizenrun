import type { OutboundFetch } from '../../lib/outbound-fetch.ts';

/** One call the code under test made, as the fake recorded it. */
export type FakeRequest = {
  host: string;
  method: string;
  path: string;
  /** Lower-cased header names. */
  headers: Record<string, string>;
  /** The body as text: a form or a string as written, JSON as its text; null when absent. */
  body: string | null;
};

/** What a route answers; `json` is served with `content-type: application/json`. */
export type FakeResponse = {
  status: number;
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
};

/** A call no route matched. Names the host and method, never the body. */
export class UnexpectedOutboundCall extends Error {
  override readonly name = 'UnexpectedOutboundCall';

  constructor(host: string, method: string) {
    super(`No fake route for ${method} ${host}.`);
  }
}

/** The fake in place of the outbound fetch (TEST-fake-outbound). */
export type FakeOutbound = {
  /** What a test passes as the outbound dependency. */
  readonly fetch: OutboundFetch;
  on(
    host: string,
    method: string,
    pathPattern: string | RegExp,
    handler: (request: FakeRequest) => FakeResponse | Promise<FakeResponse>,
  ): void;
  /** Every call, in order, matched or not. */
  readonly calls: readonly FakeRequest[];
  reset(): void;
};

type Route = {
  host: string;
  method: string;
  pathPattern: string | RegExp;
  handler: (request: FakeRequest) => FakeResponse | Promise<FakeResponse>;
};

function headersOf(init: RequestInit): Record<string, string> {
  const headers: Record<string, string> = {};
  // Headers lower-cases every name it holds.
  new Headers(init.headers).forEach((value, name) => {
    headers[name] = value;
  });
  return headers;
}

async function bodyOf(body: RequestInit['body']): Promise<string | null> {
  if (body === undefined || body === null) {
    return null;
  }
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof URLSearchParams) {
    return body.toString();
  }
  // A Blob, a buffer, a FormData or a stream: read it the way a request would send it.
  return new Response(body).text();
}

function matches(route: Route, host: string, method: string, path: string): boolean {
  if (route.host !== host || route.method.toUpperCase() !== method) {
    return false;
  }
  if (typeof route.pathPattern === 'string') {
    const query = path.indexOf('?');
    return route.pathPattern === (query === -1 ? path : path.slice(0, query));
  }
  route.pathPattern.lastIndex = 0;
  return route.pathPattern.test(path);
}

function responseOf(answer: FakeResponse): Response {
  const headers = new Headers(answer.headers);
  let body: string | null = answer.body ?? null;
  if (answer.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(answer.json);
  }
  return new Response(body, { status: answer.status, headers });
}

/**
 * A fake outbound fetch with no routes (TEST-fake-outbound). A call is recorded, then answered by
 * the first registered route whose host, method and path match: a string pattern equals the path
 * without its query, a RegExp is tested against the full path. A call with no route throws
 * UnexpectedOutboundCall. Nothing ever reaches the network.
 */
export function createFakeOutbound(): FakeOutbound {
  const routes: Route[] = [];
  const calls: FakeRequest[] = [];

  const fetch: OutboundFetch = async (host, path, init = {}) => {
    init.signal?.throwIfAborted();
    const method = (init.method ?? 'GET').toUpperCase();
    const request: FakeRequest = {
      host,
      method,
      path,
      headers: headersOf(init),
      body: await bodyOf(init.body),
    };
    calls.push(request);
    init.signal?.throwIfAborted();
    const route = routes.find((entry) => matches(entry, host, method, path));
    if (route === undefined) {
      throw new UnexpectedOutboundCall(host, method);
    }
    return responseOf(await route.handler(request));
  };

  return {
    fetch,
    on: (host, method, pathPattern, handler) => {
      routes.push({ host, method, pathPattern, handler });
    },
    calls,
    reset: () => {
      routes.length = 0;
      calls.length = 0;
    },
  };
}
