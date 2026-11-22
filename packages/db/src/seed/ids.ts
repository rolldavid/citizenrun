import { createHash } from 'node:crypto';

/** The fixed id literals of seed users, their identities, consents and avatar uploads (TC-08). */
export const SEED_IDS = {} as const;

const RAND_B_BITS = 62n;
const RAND_B_MASK = (1n << RAND_B_BITS) - 1n;
const MAX_UNIX_MS = 2 ** 48 - 1;

/**
 * A version 7 uuid for a time-sensitive seed or test row (TC-08): its 48-bit time field is `at`'s
 * Unix millisecond and its 74 random bits are the first 74 bits of SHA-256 of `<kind>:<ordinal>`,
 * the first 12 in `rand_a` and the next 62 in `rand_b`. Throws RangeError for an invalid date, a
 * time outside the 48-bit field or an ordinal that is not a non-negative integer.
 */
export function seedId(kind: string, ordinal: number, at: Date): string {
  const ms = at.getTime();
  if (!Number.isInteger(ms) || ms < 0 || ms > MAX_UNIX_MS) {
    throw new RangeError('seedId needs a valid date inside the 48-bit time field');
  }
  if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
    throw new RangeError('seedId needs a non-negative integer ordinal');
  }
  const digest = createHash('sha256')
    .update(`${kind}:${String(ordinal)}`)
    .digest();
  // The first 80 bits of the digest; the top 74 of them are the random bits.
  const first80 = BigInt(`0x${digest.subarray(0, 10).toString('hex')}`);
  const random74 = first80 >> 6n;
  const randA = random74 >> RAND_B_BITS;
  const randB = random74 & RAND_B_MASK;

  const time = ms.toString(16).padStart(12, '0');
  const versionAndRandA = (0x7000n | randA).toString(16).padStart(4, '0');
  const variantAndRandB = ((0b10n << RAND_B_BITS) | randB).toString(16).padStart(16, '0');
  return [
    time.slice(0, 8),
    time.slice(8, 12),
    versionAndRandA,
    variantAndRandB.slice(0, 4),
    variantAndRandB.slice(4),
  ].join('-');
}
