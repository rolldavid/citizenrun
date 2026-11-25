// L-keys: plain and keyed hashes (CTL-07).
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { normalizeAddress } from './address.ts';
import type { KeyRing, KeyLabel, DerivedKey } from './keys.ts';

export type KeyedInput =
  | { kind: 'handle'; handle: string } // input: the lower-case handle
  | { kind: 'subject'; provider: 'email' | 'apple' | 'google'; subject: string } // input: provider + ':' + subject
  | { kind: 'email'; email: string } // input: the lower-case email
  | { kind: 'addr'; addr: string; now: Date } // input: 'addr:' + UTC YYYY-MM-DD + ':' + normalised address
  | { kind: 'user'; userId: string }; // input: 'user:' + the uuid

const HEX_PATTERN = /^[0-9a-fA-F]+$/;
const ISO_DATE_LENGTH = 10;

/** Lower-case hex SHA-256 of the UTF-8 bytes of `value`. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Constant-time equality of two hex strings; false when the lengths differ or either is not hex. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || !HEX_PATTERN.test(a) || !HEX_PATTERN.test(b)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function unexpectedInput(value: never): never;
function unexpectedInput(): never {
  throw new Error('Unexpected keyed input');
}

function keyedInputText(input: KeyedInput): string {
  switch (input.kind) {
    case 'handle':
      return input.handle.toLowerCase();
    case 'subject':
      return `${input.provider}:${input.subject}`;
    case 'email':
      return input.email.toLowerCase();
    case 'addr':
      // The UTC date is the daily salt: one address hashes differently each UTC day (CTL-07).
      return `addr:${input.now.toISOString().slice(0, ISO_DATE_LENGTH)}:${normalizeAddress(input.addr)}`;
    case 'user':
      return `user:${input.userId}`;
    default:
      return unexpectedInput(input);
  }
}

const IDENTITY_HASH: KeyLabel = 'identity-hash';

function hmacHex(key: DerivedKey, text: string): string {
  return createHmac('sha256', key.bytes).update(text, 'utf8').digest('hex');
}

/** Lower-case hex HMAC-SHA256 of the input's text under the current `identity-hash` key. */
export function keyedHash(ring: KeyRing, input: KeyedInput): string {
  return hmacHex(ring.current[IDENTITY_HASH], keyedInputText(input));
}

/** The current key's hash, then the previous key's when a previous key exists and it differs. */
export function keyedHashCandidates(ring: KeyRing, input: KeyedInput): string[] {
  const text = keyedInputText(input);
  const current = hmacHex(ring.current[IDENTITY_HASH], text);
  if (ring.previous === null) {
    return [current];
  }
  const previous = hmacHex(ring.previous[IDENTITY_HASH], text);
  return previous === current ? [current] : [current, previous];
}
