// L-keys: the stored form of a sign-in code (D-243).
import { createHmac } from 'node:crypto';
import type { KeyRing } from './keys.ts';

/** Lower-case hex HMAC-SHA256 of the lower-cased email followed by the code, under `email-code`. */
export function emailCodeHash(ring: KeyRing, email: string, code: string): string {
  return createHmac('sha256', ring.current['email-code'].bytes)
    .update(email.toLowerCase() + code, 'utf8')
    .digest('hex');
}
