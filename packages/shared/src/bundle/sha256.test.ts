import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256.ts';

/** The platform's own digest (Web Crypto), to compare with. */
async function platformDigest(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('sha256Hex', () => {
  it('gives the FIPS 180-4 digest of the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('gives the FIPS 180-4 digest of abc', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the UTF-8 bytes of the text', () => {
    expect(sha256Hex('José')).toBe(
      '24c2ab65b7adab7e070ba05a00a3f3ae074e28b8bcdd59735b7107e7a538a551',
    );
  });

  it('agrees with the platform digest on a 1,000,000-character input', async () => {
    const text = 'a'.repeat(999_992) + 'é漢字🙂xyz';
    expect(text.length).toBe(1_000_000);
    expect(sha256Hex(text)).toBe(await platformDigest(text));
  });

  it('agrees with the platform digest at every padding boundary', async () => {
    for (let length = 50; length <= 130; length++) {
      const text = 'x'.repeat(length);
      expect(sha256Hex(text)).toBe(await platformDigest(text));
    }
  });
});
