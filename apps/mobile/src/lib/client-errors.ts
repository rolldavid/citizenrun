import { ApiError, CreateClientErrorBodySchema, lastRequestId } from '@citizenrun/shared';
import type { CreateClientErrorBody } from '@citizenrun/shared';
import { createClientError } from '@citizenrun/shared/api';

import { session } from '@/platform/session';
import type { ClientInfo } from '@/platform/session';
import { PlatformError } from '@/platform/shared';

// Every report carries the fixed fields of E-SAFE-02 and nothing else: no message, no free text, no state, no
// input, no URL and no user id (INV-49).

export const CLIENT_ERROR_MAX_BYTES = 4_096; // E-SAFE-02
export const CLIENT_ERROR_MAX_FRAMES = 20; // E-SAFE-02
export type ClientErrorFrame = { file: string; line: number; column: number };
export type ClientErrorContext = { route: string | null; component: string | null };

const ROUTE_MAX = 200;
const ROUTE_PATTERN = /^\/[A-Za-z0-9_\-/[\]().+]*$/;
const COMPONENT_LINE = /^(?:at|in)\s+([A-Za-z0-9_$.]{1,100})\b/;
const FRAME_AT_END = /(?:^\s*|\(|@|\bat\s+)([^\s()]+):(\d+):(\d+)\)?\s*$/;
const ORIGIN_PREFIX = /^.*?[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/]*/;
const QUERY_OR_HASH = /[?#].*$/;
const FILE_MAX = 200;
const FILE_PATTERN = /^[A-Za-z0-9_\-/.@]+$/;
const POSITION_MAX = 10_000_000;
const NAME_PATTERN = /^[A-Za-z0-9_$.]+$/;
const NAME_MAX = 100;
const CODE_PATTERN = /^[a-z][a-z0-9_.]{0,63}$/;
const CHUNK_LOAD_MESSAGE =
  /Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to load bundle/i;

/** Expo Router segments as a route pattern ('/office/[slug]'); null when it fails E-SAFE-02's route pattern. */
export function routePattern(segments: readonly string[]): string | null {
  const pattern = `/${segments.join('/')}`;
  if (pattern.length > ROUTE_MAX || !ROUTE_PATTERN.test(pattern)) {
    return null;
  }
  return pattern;
}

/** The first component name in React's component stack, or null. */
export function componentFromStack(componentStack: string | null | undefined): string | null {
  if (componentStack === null || componentStack === undefined) {
    return null;
  }
  for (const line of componentStack.split('\n')) {
    const match = COMPONENT_LINE.exec(line.trim());
    if (match?.[1] !== undefined) {
      return match[1];
    }
  }
  return null;
}

function isPosition(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= POSITION_MAX;
}

function frameFromLine(line: string): ClientErrorFrame | null {
  const match = FRAME_AT_END.exec(line);
  const location = match?.[1];
  const lineText = match?.[2];
  const columnText = match?.[3];
  if (location === undefined || lineText === undefined || columnText === undefined) {
    return null;
  }
  const file = location.replace(ORIGIN_PREFIX, '').replace(QUERY_OR_HASH, '');
  const lineNumber = Number(lineText);
  const column = Number(columnText);
  if (
    file.length < 1 ||
    file.length > FILE_MAX ||
    !FILE_PATTERN.test(file) ||
    !isPosition(lineNumber) ||
    !isPosition(column)
  ) {
    return null;
  }
  return { file, line: lineNumber, column };
}

/** File, line and column of each stack frame, without origin or query; at most 20. */
export function framesFromStack(stack: unknown): ClientErrorFrame[] {
  if (typeof stack !== 'string') {
    return [];
  }
  const frames: ClientErrorFrame[] = [];
  for (const line of stack.split('\n')) {
    if (frames.length >= CLIENT_ERROR_MAX_FRAMES) {
      break;
    }
    const frame = frameFromLine(line);
    if (frame !== null) {
      frames.push(frame);
    }
  }
  return frames;
}

/** True for an error a failed chunk load raises. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  // The message is read here in memory only and is never sent.
  return error.name === 'ChunkLoadError' || CHUNK_LOAD_MESSAGE.test(error.message);
}

/** The error's class name when it fits E-SAFE-02's pattern, else 'Error'; 'NonError' for a thrown non-Error. */
export function errorName(error: unknown): string {
  if (!(error instanceof Error)) {
    return 'NonError';
  }
  const { name } = error;
  return name.length >= 1 && name.length <= NAME_MAX && NAME_PATTERN.test(name) ? name : 'Error';
}

/** The static code: a PlatformError's code; 'api.<code>' for an ApiError; 'app.chunk_load_failed' for a chunk
 *  load; otherwise the fallback. */
export function errorCode(error: unknown, fallbackCode: string): string {
  let code: string;
  if (error instanceof PlatformError) {
    code = error.code;
  } else if (error instanceof ApiError) {
    code = `api.${error.code}`;
  } else if (isChunkLoadError(error)) {
    code = 'app.chunk_load_failed';
  } else {
    code = fallbackCode;
  }
  return CODE_PATTERN.test(code) ? code : 'app.unknown';
}

/** E-SAFE-02's body. Pure. */
export function buildClientErrorBody(
  error: unknown,
  context: ClientErrorContext,
  fallbackCode: string,
  client: ClientInfo,
  requestId: string | null,
): CreateClientErrorBody {
  const code = errorCode(error, fallbackCode);
  const candidate = {
    name: errorName(error),
    code,
    route: context.route,
    component: context.component,
    appVersion: client.appVersion,
    platform: client.platform,
    frames: error instanceof Error ? framesFromStack(error.stack) : [],
    requestId,
  };
  const parsed = CreateClientErrorBodySchema.safeParse(candidate);
  const body: CreateClientErrorBody = parsed.success
    ? parsed.data
    : {
        name: 'Error',
        code,
        route: null,
        component: null,
        appVersion: client.appVersion,
        platform: client.platform,
        frames: [],
        requestId: null,
      };
  // The patterns admit ASCII only, so the length in characters is the length in bytes.
  while (JSON.stringify(body).length > CLIENT_ERROR_MAX_BYTES && body.frames.length > 0) {
    body.frames = body.frames.slice(0, -1);
  }
  return body;
}

function send(
  error: unknown,
  context: ClientErrorContext,
  fallbackCode: string,
  withFrames: boolean,
): void {
  try {
    const client = session.client;
    const body = buildClientErrorBody(error, context, fallbackCode, client, lastRequestId());
    const sent = withFrames ? body : { ...body, frames: [] };
    // keepalive lets the request finish while the page reloads.
    void createClientError(sent, { keepalive: true }).catch(() => undefined);
  } catch {
    // A report never throws and never reports itself.
  }
}

/** Sends a report; never throws, never waits. */
export function reportClientError(
  error: unknown,
  context: ClientErrorContext,
  fallbackCode: string,
): void {
  send(error, context, fallbackCode, true);
}

/** For form-filling, messaging and location code: the name and static code only. */
export function reportStaticCode(error: unknown, fallbackCode: string): void {
  send(error, { route: null, component: null }, fallbackCode, false);
}
