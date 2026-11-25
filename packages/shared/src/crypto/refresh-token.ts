// L-keys: the stored form of an Apple refresh token (CTL-07, D-242, D-244).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { DerivedKey, KeyRing } from './keys.ts';

// Layout: 0x01 || kid (4 bytes) || IV (12 bytes) || ciphertext || tag (16 bytes) (CTL-07).
const VERSION = 0x01;
const KID_BYTES = 4;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = 1 + KID_BYTES + IV_BYTES;

/** A refresh-token blob that cannot be read. Its message is fixed and holds no value. */
export class RefreshTokenDecryptError extends Error {
  override readonly name = 'RefreshTokenDecryptError';

  constructor() {
    super('The refresh token could not be decrypted');
  }
}

function additionalData(subject: string): Buffer {
  // Binds the ciphertext to its identity (CTL-07).
  return Buffer.from(`apple:${subject}`, 'utf8');
}

/** AES-256-GCM of `token` under the current `refresh-token-enc` key, bound to the Apple `subject`. */
export function encryptRefreshToken(ring: KeyRing, token: string, subject: string): Uint8Array {
  const key = ring.current['refresh-token-enc'];
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key.bytes, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(additionalData(subject));
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return new Uint8Array(
    Buffer.concat([Buffer.from([VERSION]), Buffer.from(key.kid, 'hex'), iv, ciphertext, tag]),
  );
}

function keyOfKid(ring: KeyRing, kid: string): DerivedKey | null {
  if (ring.current['refresh-token-enc'].kid === kid) {
    return ring.current['refresh-token-enc'];
  }
  if (ring.previous !== null && ring.previous['refresh-token-enc'].kid === kid) {
    return ring.previous['refresh-token-enc'];
  }
  return null;
}

/**
 * The refresh token in `blob`, under the current or the previous key as its kid says. Throws
 * `RefreshTokenDecryptError` on a wrong version, an unknown kid, a short blob or a failed tag.
 */
export function decryptRefreshToken(ring: KeyRing, blob: Uint8Array, subject: string): string {
  if (blob.length < HEADER_BYTES + TAG_BYTES || blob[0] !== VERSION) {
    throw new RefreshTokenDecryptError();
  }
  const bytes = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const key = keyOfKid(ring, bytes.subarray(1, 1 + KID_BYTES).toString('hex'));
  if (key === null) {
    throw new RefreshTokenDecryptError();
  }
  const iv = bytes.subarray(1 + KID_BYTES, HEADER_BYTES);
  const ciphertext = bytes.subarray(HEADER_BYTES, bytes.length - TAG_BYTES);
  const tag = bytes.subarray(bytes.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key.bytes, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(additionalData(subject));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new RefreshTokenDecryptError();
  }
}
