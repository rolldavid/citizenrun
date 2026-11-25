// L-keys: the per-export group key and group ids (CTL-07). The previous key is never used here.
import { createHmac, hkdfSync } from 'node:crypto';
import type { KeyRing } from './keys.ts';

const SALT_BYTES = 32; // CTL-07
const GROUP_KEY_BYTES = 32; // CTL-07
const GROUP_ID_HEX = 16; // CTL-07
const GROUP_KEY_INFO = 'ml-export-group'; // CTL-07

/** The 32-byte group key of one export run; throws `RangeError` unless `salt` is 32 bytes. */
export function exportGroupKey(ring: KeyRing, salt: Uint8Array): Uint8Array {
  if (salt.length !== SALT_BYTES) {
    throw new RangeError('The export salt must be 32 bytes');
  }
  return new Uint8Array(
    hkdfSync('sha256', ring.current['export-hash'].bytes, salt, GROUP_KEY_INFO, GROUP_KEY_BYTES),
  );
}

/** The group id of `uuid` under `groupKey`: 16 lower-case hex characters. */
export function exportGroupId(groupKey: Uint8Array, uuid: string): string {
  return createHmac('sha256', groupKey).update(uuid, 'utf8').digest('hex').slice(0, GROUP_ID_HEX);
}
