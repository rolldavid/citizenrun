import type { MiddlewareHandler } from 'hono';
import { ApiError, assertNever } from '@citizenrun/shared';
import type { Deps } from '../deps.ts';
import type { ApiEnv } from '../env.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import type { RouteMetaIndex } from './route-meta.ts';

/** A parsed `X-OS-Client` value; `version` is null for the bare value `web`. */
export type ClientValue = {
  platform: 'ios' | 'android' | 'web';
  version: readonly [number, number, number] | null;
};

const CLIENT_HEADER = 'X-OS-Client';
// L-client-version.
const CLIENT_VALUE_PATTERN =
  /^(ios|android|web)\/(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})\.(0|[1-9][0-9]{0,3})$/;
const BARE_WEB = 'web';

type Version = readonly [number, number, number];

function isPlatform(value: string | undefined): value is ClientValue['platform'] {
  return value === 'ios' || value === 'android' || value === 'web';
}

/** Parses an `X-OS-Client` value; null when it is missing or does not match the format. */
export function parseClientValue(raw: string | null | undefined): ClientValue | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (raw === BARE_WEB) {
    return { platform: 'web', version: null };
  }
  const match = CLIENT_VALUE_PATTERN.exec(raw);
  if (match === null) {
    return null;
  }
  const [, platform, major, minor, patch] = match;
  if (!isPlatform(platform)) {
    return null;
  }
  return { platform, version: [Number(major), Number(minor), Number(patch)] };
}

// The env module has already checked the minimum against the same version format.
function versionOf(text: string): Version {
  const [major = 0, minor = 0, patch = 0] = text.split('.').map(Number);
  return [major, minor, patch];
}

function minimumFor(platform: ClientValue['platform'], env: ApiEnv): Version {
  switch (platform) {
    case 'ios':
      return versionOf(env.MIN_CLIENT_VERSION_IOS);
    case 'android':
      return versionOf(env.MIN_CLIENT_VERSION_ANDROID);
    case 'web':
      return versionOf(env.MIN_CLIENT_VERSION_WEB);
    default:
      return assertNever(platform);
  }
}

/** Whether the client's version is below its platform's minimum; a bare `web` never is. */
export function isBelowMinimum(value: ClientValue, env: ApiEnv): boolean {
  if (value.version === null) {
    return false;
  }
  const minimum = minimumFor(value.platform, env);
  for (let part = 0; part < 3; part += 1) {
    const have = value.version[part] ?? 0;
    const need = minimum[part] ?? 0;
    if (have !== need) {
      return have < need;
    }
  }
  return false;
}

/**
 * L-client-version for `/v1`: a matched operation that is not exempt needs a well-formed
 * `X-OS-Client` (400 `client_header_required`) at or above its platform's minimum (426
 * `upgrade_required`); the parsed value goes on the context.
 */
export function clientVersion(deps: Deps, index: RouteMetaIndex): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    const meta = index.match(c);
    if (meta === null || meta.clientHeader === 'exempt') {
      await next();
      return;
    }
    const raw = c.req.header(CLIENT_HEADER);
    const value = parseClientValue(raw);
    if (raw === undefined || value === null) {
      throw new ApiError('client_header_required');
    }
    if (isBelowMinimum(value, deps.env)) {
      throw new ApiError('upgrade_required');
    }
    c.set('client', { value, raw });
    await next();
  };
}
