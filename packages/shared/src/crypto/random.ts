// L-keys: random secrets (CTL-07).
import { randomBytes, randomInt } from 'node:crypto';

const TOKEN_BYTES = 32; // CTL-07: 43 base64url characters
const EMAIL_CODE_RANGE = 1_000_000; // D-243: six digits
const EMAIL_CODE_DIGITS = 6; // D-243

/** 32 random bytes as base64url without padding: 43 characters. */
export function randomToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** A uniformly random six-digit sign-in code, zero-padded. */
export function newEmailCode(): string {
  return String(randomInt(0, EMAIL_CODE_RANGE)).padStart(EMAIL_CODE_DIGITS, '0');
}
