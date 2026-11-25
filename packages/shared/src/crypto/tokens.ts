// L-keys: signed tokens (CTL-07, D-436). The purposes are exactly the signed-token registry's.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DerivedKey, KeyRing } from './keys.ts';

export type SignedPurpose = 'search' | 'unsubscribe' | 'apple_state' | 'public_form';

type TokenData = Readonly<Record<string, string | number>>;

// Bounds the work done on hostile input (CTL-07).
const TOKEN_MAX = 4096;
const RESERVED_KEYS = ['p', 'k', 'e'] as const;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MS_PER_SECOND = 1000;

function epochSeconds(now: Date): number {
  return Math.floor(now.getTime() / MS_PER_SECOND);
}

function mac(key: DerivedKey, purpose: SignedPurpose, body: string): string {
  return createHmac('sha256', key.bytes).update(`${purpose}.${body}`, 'utf8').digest('base64url');
}

/**
 * A token for `purpose` carrying `data`, valid for `ttlSeconds` after `now`, under the current
 * `link-signing` key. Throws `RangeError` when `data` uses one of the keys `p`, `k` or `e`.
 */
export function signToken(
  ring: KeyRing,
  purpose: SignedPurpose,
  data: TokenData,
  ttlSeconds: number,
  now: Date,
): string {
  if (RESERVED_KEYS.some((name) => Object.hasOwn(data, name))) {
    throw new RangeError('Signed-token data may not use the keys p, k or e');
  }
  const key = ring.current['link-signing'];
  const payload = { p: purpose, k: key.kid, e: epochSeconds(now) + ttlSeconds, ...data };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${mac(key, purpose, body)}`;
}

function keyOfKid(ring: KeyRing, kid: string): DerivedKey | null {
  if (ring.current['link-signing'].kid === kid) {
    return ring.current['link-signing'];
  }
  if (ring.previous !== null && ring.previous['link-signing'].kid === kid) {
    return ring.previous['link-signing'];
  }
  return null;
}

function parsePayload(body: string): Record<string, string | number> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const entries: [string, string | number][] = [];
  for (const [name, value] of Object.entries(parsed)) {
    if (typeof value !== 'string' && typeof value !== 'number') {
      return null;
    }
    entries.push([name, value]);
  }
  // fromEntries defines own properties, so a key such as __proto__ stays plain data.
  return Object.fromEntries(entries);
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * The data of a valid, unexpired token for `purpose` under the current or previous `link-signing`
 * key, frozen; null, never a throw, for any other input.
 */
export function verifyToken(
  ring: KeyRing,
  purpose: SignedPurpose,
  token: string,
  now: Date,
): TokenData | null {
  if (token.length > TOKEN_MAX) {
    return null;
  }
  const parts = token.split('.');
  const [body, signature] = parts;
  if (parts.length !== 2 || body === undefined || signature === undefined) {
    return null;
  }
  if (!BASE64URL_PATTERN.test(body) || !BASE64URL_PATTERN.test(signature)) {
    return null;
  }
  const payload = parsePayload(body);
  if (payload === null) {
    return null;
  }
  const { p, k, e, ...data } = payload;
  if (p !== purpose || typeof k !== 'string' || typeof e !== 'number') {
    return null;
  }
  const key = keyOfKid(ring, k);
  // The MAC is compared as its base64url text, so a changed trailing character never verifies.
  if (key === null || !sameText(mac(key, purpose, body), signature)) {
    return null;
  }
  if (epochSeconds(now) >= e) {
    return null;
  }
  return Object.freeze(data);
}
