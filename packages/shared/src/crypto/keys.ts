// L-keys: the keys derived from APP_SECRET and APP_SECRET_PREVIOUS (CTL-07, D-244).
import { createHash, hkdfSync } from 'node:crypto';

export type KeyLabel =
  | 'refresh-token-enc' // D-244: AES-256-GCM key for Apple refresh tokens
  | 'calendar-token' // D-244: derived for completeness; D-252's plain SHA-256 needs no key
  | 'export-hash' // D-244: base key of the per-export group key
  | 'email-code' // D-243, D-244: HMAC of sign-in codes
  | 'identity-hash' // keyed hashes of handles, identities, emails, addresses, user ids
  | 'link-signing'; // MAC of signed tokens

/** One derived key. `bytes` is not enumerable, so serialising a key never carries it. */
export interface DerivedKey {
  readonly kid: string;
  readonly bytes: Uint8Array;
}

/** The keys of the current secret and, after a rotation, of the previous one. */
export interface KeyRing {
  readonly current: Readonly<Record<KeyLabel, DerivedKey>>;
  readonly previous: Readonly<Record<KeyLabel, DerivedKey>> | null;
}

const SECRET_PATTERN = /^[0-9a-fA-F]{64}$/;
const KEY_BYTES = 32; // CTL-07
const KID_HEX = 8; // CTL-07
const EMPTY_SALT = new Uint8Array(0); // CTL-07: the derivation salt is zero-length

function deriveKey(secret: Uint8Array, label: KeyLabel): DerivedKey {
  // The info string keeps the protocol prefix `os`, so a rename of the product changes no key (CTL-07).
  const bytes = new Uint8Array(hkdfSync('sha256', secret, EMPTY_SALT, `os/${label}/v1`, KEY_BYTES));
  const kid = createHash('sha256').update(bytes).digest('hex').slice(0, KID_HEX);
  const key: DerivedKey = { kid, bytes };
  // Key material never reaches a log line through JSON.stringify of a ring.
  Object.defineProperty(key, 'bytes', { enumerable: false });
  return Object.freeze(key);
}

function deriveKeys(secretHex: string): Readonly<Record<KeyLabel, DerivedKey>> {
  const secret = new Uint8Array(Buffer.from(secretHex, 'hex'));
  return Object.freeze({
    'refresh-token-enc': deriveKey(secret, 'refresh-token-enc'),
    'calendar-token': deriveKey(secret, 'calendar-token'),
    'export-hash': deriveKey(secret, 'export-hash'),
    'email-code': deriveKey(secret, 'email-code'),
    'identity-hash': deriveKey(secret, 'identity-hash'),
    'link-signing': deriveKey(secret, 'link-signing'),
  });
}

/**
 * Derives every key from the 64-hex-character secret and, when not null, the previous one. Throws
 * `RangeError` naming the argument, never its value, when either is not 64 hex characters.
 */
export function loadKeyRing(appSecretHex: string, previousHex: string | null): KeyRing {
  if (!SECRET_PATTERN.test(appSecretHex)) {
    throw new RangeError('APP_SECRET must be 64 hex characters');
  }
  if (previousHex !== null && !SECRET_PATTERN.test(previousHex)) {
    throw new RangeError('APP_SECRET_PREVIOUS must be 64 hex characters');
  }
  return Object.freeze({
    current: deriveKeys(appSecretHex),
    previous: previousHex === null ? null : deriveKeys(previousHex),
  });
}
