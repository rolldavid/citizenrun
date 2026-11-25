import { ApiError } from '../errors.ts';
import type { ErrorCode, FieldCode } from '../errors.ts';
import { ErrorEnvelopeSchema } from '../schemas/common.ts';

/** How the generated client reaches the API (D-032); the `session` platform module supplies it. */
export type ApiClientConfig = {
  /** Absolute on phones; '' on the web, which calls its own origin. */
  origin: string;
  /** The `X-OS-Client` value, `<platform>/<version>`. */
  clientHeader: string;
  /** The `Authorization` value (`Bearer <token>`) on phones; null on the web and when signed out. */
  getAuthorization: () => string | null;
  /** `RequestCredentials`, named through `RequestInit` so Node-only type checks (no DOM lib) resolve it. */
  credentials: NonNullable<RequestInit['credentials']>;
  onUnauthorized: () => void;
  onUpgradeRequired: () => void;
};

/**
 * The error type of every generated hook and query option (D-821). Orval reads this export from the
 * mutator and writes `ErrorType<body>`; apiFetch throws ApiError for every status that is not 2xx,
 * never the response body, so the answer is ApiError whatever the body type (every type extends
 * `unknown`).
 */
export type ErrorType<ErrorBody> = [ErrorBody] extends [unknown] ? ApiError : never;

let clientConfig: ApiClientConfig | null = null;
let requestId: string | null = null;

/** Stores the client's configuration; called once at startup. A later call replaces it. */
export function configureApiClient(config: ApiClientConfig): void {
  clientConfig = config;
}

/** The `X-Request-Id` of the last response received, success or error; null before the first. */
export function lastRequestId(): string | null {
  return requestId;
}

const WHOLE_SECONDS = /^\d+$/;
// One `/` and then neither `/` nor `\`: the path stays on the configured origin. On the web the
// origin is empty, and `//host` or `/\host` would name another host.
const API_PATH = /^\/(?![/\\])/;

function retryAfterOf(headers: Headers): number | null {
  const value = headers.get('Retry-After')?.trim();
  return value !== undefined && WHOLE_SECONDS.test(value) ? Number(value) : null;
}

type ErrorParts = { code: ErrorCode; fields: Readonly<Record<string, FieldCode>> };

async function errorPartsOf(response: Response): Promise<ErrorParts> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const envelope = ErrorEnvelopeSchema.safeParse(body);
  if (envelope.success) {
    return { code: envelope.data.error.code, fields: envelope.data.error.fields };
  }
  // A body that is not the envelope: the down body of /readyz, a proxy's error page.
  return { code: response.status === 503 ? 'unavailable' : 'internal', fields: {} };
}

/**
 * The generated client's one mutator. Sends `X-OS-Client`, the session credentials and the
 * bearer value, returns the parsed JSON of a 2xx response and throws `ApiError` for any other
 * status. A network failure is rethrown unchanged. It never logs. `url` is a path that starts with
 * exactly one `/`; anything else is refused before a request is made.
 */
export async function apiFetch<T>(url: string, init: RequestInit): Promise<T> {
  const config = clientConfig;
  if (config === null) {
    throw new Error('API client is not configured');
  }
  if (!API_PATH.test(url)) {
    throw new Error('apiFetch takes a path that starts with exactly one /');
  }

  const headers = new Headers(init.headers);
  headers.set('X-OS-Client', config.clientHeader);
  headers.set('Accept', 'application/json');
  const authorization = config.getAuthorization();
  if (authorization !== null) {
    headers.set('Authorization', authorization);
  }

  const response = await fetch(`${config.origin}${url}`, {
    ...init,
    credentials: config.credentials,
    headers,
  });
  requestId = response.headers.get('X-Request-Id');

  if (response.ok) {
    if (response.status === 204) {
      return undefined as T; // a 204 has no body; the generated type of such an operation is void
    }
    return (await response.json()) as T; // the generated client types the body from the operation's 2xx schema
  }

  const { code, fields } = await errorPartsOf(response);
  if (response.status === 401) {
    config.onUnauthorized();
  }
  if (response.status === 426) {
    config.onUpgradeRequired();
  }
  const retryAfterSeconds = retryAfterOf(response.headers);
  throw new ApiError(code, {
    fields,
    ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }),
  });
}
