import type { Context, ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { QueueMissingError } from '@citizenrun/db';
import { ApiError, ERROR_CODES } from '@citizenrun/shared';
import type { ErrorCode, ErrorEnvelope, FieldCode } from '@citizenrun/shared';
import type { Deps } from '../deps.ts';
import { JSON_CONTENT_TYPE } from '../respond.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import { isV1Path } from './route-meta.ts';

const PLAIN_TEXT = 'text/plain; charset=utf-8';
const NO_STORE = 'no-store';
const ERROR_CLASS_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,59}$/;

// The fixed body of a plain-text error outside `/v1`, by status.
const PLAIN_TEXT_BODIES: Readonly<Record<number, string>> = {
  400: 'Bad request',
  404: 'Not found',
  413: 'Payload too large',
  429: 'Too many requests',
  500: 'Internal error',
  503: 'Service unavailable',
};

type Mapped = { code: ErrorCode; fields: Readonly<Record<string, FieldCode>> };

// The class an error is logged under; 'Error' when its name is not an identifier or cannot be read.
function errorClassOf(error: Error): string {
  try {
    const name: unknown = error.name;
    return typeof name === 'string' && ERROR_CLASS_PATTERN.test(name) ? name : 'Error';
  } catch {
    return 'Error';
  }
}

function envelope(code: ErrorCode, fields: Readonly<Record<string, FieldCode>>): ErrorEnvelope {
  return { error: { code, message: ERROR_CODES[code].message, fields: { ...fields } } };
}

// Maps an error to its code; an error that is not ours is logged here, an ApiError is not (the
// request line carries its code).
function mapError(deps: Deps, error: Error, c: Context<RouterEnv>): Mapped {
  if (error instanceof ApiError) {
    return { code: error.code, fields: error.fields };
  }
  if (error instanceof HTTPException && error.status === 400) {
    return { code: 'invalid_request', fields: {} };
  }
  if (error instanceof HTTPException && error.status === 413) {
    return { code: 'payload_too_large', fields: {} };
  }
  const requestId: unknown = c.get('requestId');
  if (error instanceof QueueMissingError) {
    deps.logger.warn('queue.missing', { requestId, queue: error.queue });
    return { code: 'unavailable', fields: {} };
  }
  // The logger runs redact(): the class, a static message and the stack, never the error's text.
  deps.logger.error('request.error', { requestId, errorClass: errorClassOf(error), error });
  return { code: 'internal', fields: {} };
}

function retryAfterOf(error: Error, c: Context<RouterEnv>): number | null {
  const fromContext: unknown = c.get('retryAfterSeconds');
  if (typeof fromContext === 'number') {
    return fromContext;
  }
  return error instanceof ApiError ? error.retryAfterSeconds : null;
}

function answer(
  c: Context<RouterEnv>,
  code: ErrorCode,
  fields: Readonly<Record<string, FieldCode>>,
  retryAfterSeconds: number | null,
): Response {
  c.set('errorCode', code);
  const status = ERROR_CODES[code].status;
  if (isV1Path(c.req.path)) {
    const headers: Record<string, string> = {
      'Content-Type': JSON_CONTENT_TYPE,
      'Cache-Control': NO_STORE,
    };
    if (code === 'rate_limited' && retryAfterSeconds !== null) {
      headers['Retry-After'] = String(retryAfterSeconds);
    }
    return c.json(envelope(code, fields), status, headers);
  }
  const body = PLAIN_TEXT_BODIES[status] ?? (status >= 500 ? 'Internal error' : 'Bad request');
  return c.text(body, status, { 'Content-Type': PLAIN_TEXT });
}

/**
 * The one error handler (L-error-registry): the envelope with the registry's status and fixed
 * message on `/v1`, a fixed plain-text body elsewhere; never user input, SQL, an id or a stack.
 */
export function handleError(deps: Deps): ErrorHandler<RouterEnv> {
  return (error, c) => {
    const mapped = mapError(deps, error, c);
    return answer(c, mapped.code, mapped.fields, retryAfterOf(error, c));
  };
}

/** A path no route claims: the `not_found` envelope on `/v1` (OPTIONS included), else plain text. */
export function notFound(deps: Deps): NotFoundHandler<RouterEnv> {
  const onError = handleError(deps);
  return (c) => onError(new ApiError('not_found'), c);
}
