import { describe, expect, it } from 'vitest';
import { assertNever } from '../errors.ts';
import {
  decryptRefreshToken,
  emailCodeHash,
  encryptRefreshToken,
  exportGroupId,
  exportGroupKey,
  keyedHash,
  keyedHashCandidates,
  loadKeyRing,
  newEmailCode,
  RefreshTokenDecryptError,
  randomToken,
  safeEqualHex,
  sha256Hex,
  signToken,
  verifyToken,
} from './index.ts';
import type { KeyLabel, KeyRing, SignedPurpose } from './index.ts';

// Fixture secrets: the all-zero secret of the CTL-07 vectors and two more made at run time.
const ZERO_SECRET = '0'.repeat(64);
const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);
const ring = loadKeyRing(ZERO_SECRET, null);

const NOW = new Date('2027-03-05T22:00:00.000Z');
const FIXTURE_USER = '0195a7e0-0000-7000-8000-000000000001';
const FIXTURE_EMAIL = 'person@example.test';

const LABELS: readonly KeyLabel[] = [
  'identity-hash',
  'email-code',
  'link-signing',
  'refresh-token-enc',
  'export-hash',
  'calendar-token',
];

function keyHex(keys: KeyRing['current'], label: KeyLabel): string {
  return Buffer.from(keys[label].bytes).toString('hex');
}

function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function flipChar(text: string, index: number): string {
  const char = text[index];
  const replacement = char === 'A' ? 'B' : 'A';
  return text.slice(0, index) + replacement + text.slice(index + 1);
}

describe('L-keys', () => {
  it('derived keys and kids', () => {
    const expected: Record<KeyLabel, [string, string]> = {
      'identity-hash': [
        '424a77dac2f11ec8b970ef00eb29299779b1f24c4d6d19a8f35c79573f1301a1',
        '9880f43e',
      ],
      'email-code': [
        '8280e7225e9c7f4d168d2e437624d98cf1f01758fcaa82ca14078d614790b239',
        'b8b3007b',
      ],
      'link-signing': [
        'df8cd14dc2a9b16a330cd8f26ae0bf9ff6a9f3962350a2a4bdc386141bd6ddf7',
        'c29a95ea',
      ],
      'refresh-token-enc': [
        'f78adfeb48a42cb41e5d0bddbe82462ce27b68b131bd1199e83148f37e8f0fd6',
        'fae06d5a',
      ],
      'export-hash': [
        'b41797132b75a7b2e661bfc2b513372e2cd4268e21c8f19770912036623f7eb5',
        'be316e6d',
      ],
      'calendar-token': [
        'a6267f6908de6ff09bb0f278c9cac316645691eafe5ebe018fb6c8cbc600ff62',
        '44404411',
      ],
    };
    for (const label of LABELS) {
      expect([keyHex(ring.current, label), ring.current[label].kid]).toEqual(expected[label]);
    }
    expect(ring.previous).toBeNull();
  });

  it('keyedHash vectors', () => {
    expect(keyedHash(ring, { kind: 'handle', handle: 'test_alice' })).toBe(
      'aeb41d75618c969e42d4b912dc1b32adac4b97c3837cc5a21c687d1d7104f6cc',
    );
    expect(keyedHash(ring, { kind: 'subject', provider: 'apple', subject: '000123.fixture' })).toBe(
      'bf19fb04cf5e7fc198ebe3b29ddec1f6d214b79d875fdda44a68b355bf7d4702',
    );
    expect(keyedHash(ring, { kind: 'email', email: FIXTURE_EMAIL })).toBe(
      '600ff4191ae7a290e0c335201837564e775b318a47f395c8ee3495f8945aed3a',
    );
    const march5 = keyedHash(ring, {
      kind: 'addr',
      addr: '203.0.113.7',
      now: new Date('2027-03-05T12:00:00.000Z'),
    });
    const march6 = keyedHash(ring, {
      kind: 'addr',
      addr: '203.0.113.7',
      now: new Date('2027-03-06T12:00:00.000Z'),
    });
    expect(march5).toBe('e0a44b312533f30faebbd79e8f92007a5625bca457e162bc74c3d1f098d3bac4');
    expect(march6).toBe('e9f0854f007bf6acedabb795bc8e12ae52dd4cf5b7d34fc3cf8df0cb52f53bd5');
    expect(keyedHash(ring, { kind: 'user', userId: FIXTURE_USER })).toBe(
      'e579ca6e83ec953bde9f9fdd188f3f50f677894972878b4f88d04a9a910954e6',
    );
  });

  it('the address date is the UTC date of now', () => {
    // 2027-03-05 at 23:30 in New York is already 2027-03-06 in UTC.
    const lateEvening = new Date('2027-03-06T04:30:00.000Z');
    expect(keyedHash(ring, { kind: 'addr', addr: '203.0.113.7', now: lateEvening })).toBe(
      'e9f0854f007bf6acedabb795bc8e12ae52dd4cf5b7d34fc3cf8df0cb52f53bd5',
    );
  });

  it('keyed handles and emails are case-blind', () => {
    expect(keyedHash(ring, { kind: 'handle', handle: 'Test_Alice' })).toBe(
      keyedHash(ring, { kind: 'handle', handle: 'test_alice' }),
    );
    expect(keyedHash(ring, { kind: 'email', email: 'PERSON@example.test' })).toBe(
      keyedHash(ring, { kind: 'email', email: FIXTURE_EMAIL }),
    );
  });

  it('emailCodeHash vector', () => {
    const expected = '09c68f91e47ff268b62fca4a5517a77937fa4cb77ad1b2e0d468c33a60223abb';
    expect(emailCodeHash(ring, FIXTURE_EMAIL, '123456')).toBe(expected);
    expect(emailCodeHash(ring, 'PERSON@example.test', '123456')).toBe(expected);
    expect(emailCodeHash(ring, FIXTURE_EMAIL, '123457')).not.toBe(expected);
  });

  it('exportGroupKey and exportGroupId vectors', () => {
    const zeroKey = exportGroupKey(ring, new Uint8Array(32));
    expect(zeroKey).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(zeroKey).toString('hex')).toBe(
      'ee3a97ad8962dd7a348ad262e622895967d312284ab81add64cc11690d311ce8',
    );
    expect(exportGroupId(zeroKey, FIXTURE_USER)).toBe('6df1d7ba769ecd4f');
    const onesKey = exportGroupKey(ring, new Uint8Array(32).fill(0x01));
    expect(exportGroupId(onesKey, FIXTURE_USER)).toBe('90bc1faf8a01f289');
  });

  it('exportGroupKey uses the current key only', () => {
    const rotated = loadKeyRing(SECRET_B, ZERO_SECRET);
    const salt = new Uint8Array(32);
    expect(Buffer.from(exportGroupKey(rotated, salt)).toString('hex')).not.toBe(
      'ee3a97ad8962dd7a348ad262e622895967d312284ab81add64cc11690d311ce8',
    );
  });

  it('exportGroupKey refuses a salt that is not 32 bytes', () => {
    expect(() => exportGroupKey(ring, new Uint8Array(31))).toThrow(RangeError);
    expect(() => exportGroupKey(ring, new Uint8Array(33))).toThrow(RangeError);
  });
});

describe('signed tokens', () => {
  it('a token signed for search fails as unsubscribe', () => {
    const token = signToken(ring, 'search', { r: '42' }, 1800, NOW);
    expect(verifyToken(ring, 'search', token, NOW)).toEqual({ r: '42' });
    expect(verifyToken(ring, 'unsubscribe', token, NOW)).toBeNull();
  });

  it('a token signed for public_form fails as unsubscribe', () => {
    const issuedAt = Math.floor(NOW.getTime() / 1000);
    const token = signToken(ring, 'public_form', { f: 'support', i: issuedAt }, 7200, NOW);
    expect(verifyToken(ring, 'public_form', token, NOW)).toEqual({ f: 'support', i: issuedAt });
    expect(verifyToken(ring, 'unsubscribe', token, NOW)).toBeNull();
  });

  it('an expired token fails', () => {
    const token = signToken(ring, 'apple_state', { n: 'fixture' }, 600, NOW);
    expect(verifyToken(ring, 'apple_state', token, addSeconds(NOW, 599))).toEqual({ n: 'fixture' });
    expect(verifyToken(ring, 'apple_state', token, addSeconds(NOW, 600))).toBeNull();
  });

  it('a flipped bit fails', () => {
    const token = signToken(ring, 'search', { r: '42' }, 1800, NOW);
    const dot = token.indexOf('.');
    const indexes = [0, dot - 1, dot + 1, token.length - 1];
    for (const index of indexes) {
      expect(verifyToken(ring, 'search', flipChar(token, index), NOW)).toBeNull();
    }
    for (let index = 0; index < token.length; index += 1) {
      if (index !== dot) {
        expect(verifyToken(ring, 'search', flipChar(token, index), NOW)).toBeNull();
      }
    }
  });

  it('verifyToken never throws on garbage', () => {
    const encode = (value: unknown): string =>
      Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
    const inputs = [
      '',
      '.',
      'a.b.c',
      'x'.repeat(4097),
      `${encode(['search', 'c29a95ea', 9_999_999_999])}.sig`,
      `${encode({ p: 'search', k: 'c29a95ea', e: 9_999_999_999, r: { nested: 1 } })}.sig`,
      `${encode({ p: 'search', k: 'c29a95ea', e: 9_999_999_999, r: null })}.sig`,
      'not base64!.sig',
      `${Buffer.from('{not json', 'utf8').toString('base64url')}.sig`,
      `${encode('a string')}.sig`,
    ];
    for (const input of inputs) {
      expect(() => verifyToken(ring, 'search', input, NOW)).not.toThrow();
      expect(verifyToken(ring, 'search', input, NOW)).toBeNull();
    }
  });

  it('a well-signed payload that is not an object of strings and numbers fails', () => {
    const forge = (payload: unknown): string => {
      // A token whose MAC is right but whose payload breaks the shape rule.
      const token = signToken(ring, 'search', { r: '1' }, 60, NOW);
      const [, signature = ''] = token.split('.');
      return `${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')}.${signature}`;
    };
    expect(verifyToken(ring, 'search', forge([1, 2]), NOW)).toBeNull();
    expect(
      verifyToken(ring, 'search', forge({ p: 'search', k: 'c29a95ea', e: 1, x: {} }), NOW),
    ).toBeNull();
  });

  it('a token over 4,096 characters fails even when signed', () => {
    const token = signToken(ring, 'search', { r: 'x'.repeat(3100) }, 60, NOW);
    expect(token.length).toBeGreaterThan(4096);
    expect(verifyToken(ring, 'search', token, NOW)).toBeNull();
  });

  it('apple_state round trip', () => {
    const nonce = randomToken();
    const n = sha256Hex(nonce);
    const token = signToken(ring, 'apple_state', { n }, 600, NOW);
    const data = verifyToken(ring, 'apple_state', token, NOW);
    expect(data).toEqual({ n });
    expect(Object.isFrozen(data)).toBe(true);
  });

  it('the payload carries p, k and e before the data', () => {
    const token = signToken(ring, 'unsubscribe', { u: FIXTURE_USER, t: 'all' }, 60, NOW);
    const [body = ''] = token.split('.');
    expect(Buffer.from(body, 'base64url').toString('utf8')).toBe(
      JSON.stringify({
        p: 'unsubscribe',
        k: 'c29a95ea',
        e: Math.floor(NOW.getTime() / 1000) + 60,
        u: FIXTURE_USER,
        t: 'all',
      }),
    );
  });

  it('signToken refuses reserved keys', () => {
    expect(() => signToken(ring, 'search', { e: 1 }, 60, NOW)).toThrow(RangeError);
    expect(() => signToken(ring, 'search', { p: 'search' }, 60, NOW)).toThrow(RangeError);
    expect(() => signToken(ring, 'search', { k: 'x' }, 60, NOW)).toThrow(RangeError);
  });

  it('a token made under the previous secret verifies after rotation', () => {
    const ringA = loadKeyRing(SECRET_A, null);
    const token = signToken(ringA, 'search', { r: '7' }, 1800, NOW);
    expect(verifyToken(loadKeyRing(SECRET_B, SECRET_A), 'search', token, NOW)).toEqual({ r: '7' });
    expect(verifyToken(loadKeyRing(SECRET_B, null), 'search', token, NOW)).toBeNull();
  });
});

describe('refresh-token ciphertext', () => {
  it('round trip with the layout of CTL-07', () => {
    const blob = encryptRefreshToken(ring, 'fixture-refresh-token', '000123.fixture');
    expect(blob).toBeInstanceOf(Uint8Array);
    expect(blob[0]).toBe(0x01);
    expect(Buffer.from(blob.subarray(1, 5)).toString('hex')).toBe('fae06d5a');
    expect(blob.length).toBe(1 + 4 + 12 + Buffer.byteLength('fixture-refresh-token') + 16);
    expect(decryptRefreshToken(ring, blob, '000123.fixture')).toBe('fixture-refresh-token');
    const again = encryptRefreshToken(ring, 'fixture-refresh-token', '000123.fixture');
    expect(Buffer.from(again).equals(Buffer.from(blob))).toBe(false);
  });

  it('a ciphertext made under the previous secret decrypts after rotation', () => {
    const blob = encryptRefreshToken(loadKeyRing(SECRET_A, null), 'fixture-token', 'subject-1');
    expect(decryptRefreshToken(loadKeyRing(SECRET_B, SECRET_A), blob, 'subject-1')).toBe(
      'fixture-token',
    );
    expect(() => decryptRefreshToken(loadKeyRing(SECRET_B, null), blob, 'subject-1')).toThrow(
      RefreshTokenDecryptError,
    );
  });

  it('a ciphertext is bound to its subject', () => {
    const blob = encryptRefreshToken(ring, 'fixture-token', 'subject-1');
    expect(() => decryptRefreshToken(ring, blob, 'subject-2')).toThrow(RefreshTokenDecryptError);
    const version2 = Uint8Array.from(blob);
    version2[0] = 0x02;
    expect(() => decryptRefreshToken(ring, version2, 'subject-1')).toThrow(
      RefreshTokenDecryptError,
    );
    const unknownKid = Uint8Array.from(blob);
    unknownKid.set([0, 0, 0, 0], 1);
    expect(() => decryptRefreshToken(ring, unknownKid, 'subject-1')).toThrow(
      RefreshTokenDecryptError,
    );
    const tampered = Uint8Array.from(blob);
    tampered[20] = (tampered[20] ?? 0) ^ 0x01;
    expect(() => decryptRefreshToken(ring, tampered, 'subject-1')).toThrow(
      RefreshTokenDecryptError,
    );
    expect(() => decryptRefreshToken(ring, blob.subarray(0, 32), 'subject-1')).toThrow(
      RefreshTokenDecryptError,
    );
  });

  it('the decrypt error carries no value', () => {
    const blob = encryptRefreshToken(ring, 'fixture-token', 'subject-1');
    try {
      decryptRefreshToken(ring, blob, 'subject-2');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RefreshTokenDecryptError);
      expect(err).toBeInstanceOf(Error);
      const error = err instanceof Error ? err : new Error('not an error');
      expect(error.name).toBe('RefreshTokenDecryptError');
      expect(error.message).not.toContain('subject');
      expect(error.message).not.toContain('fixture');
    }
  });
});

describe('keyed hashes and addresses', () => {
  it('keyedHashCandidates lists current then previous', () => {
    const input = { kind: 'handle', handle: 'test_alice' } as const;
    const ringA = loadKeyRing(SECRET_A, null);
    const ringB = loadKeyRing(SECRET_B, null);
    const rotated = loadKeyRing(SECRET_B, SECRET_A);
    expect(keyedHashCandidates(rotated, input)).toEqual([
      keyedHash(ringB, input),
      keyedHash(ringA, input),
    ]);
    expect(keyedHashCandidates(ringA, input)).toEqual([keyedHash(ringA, input)]);
    expect(keyedHashCandidates(loadKeyRing(SECRET_A, SECRET_A), input)).toEqual([
      keyedHash(ringA, input),
    ]);
  });

  it('an IPv6 address in the same /64 hashes the same', () => {
    const hash = (addr: string): string => keyedHash(ring, { kind: 'addr', addr, now: NOW });
    expect(hash('2001:db8:1:2::1')).toBe(hash('2001:0db8:0001:0002:ffff::9'));
    expect(hash('2001:db8:1:2::1')).toBe(hash('[2001:DB8:1:2::7%eth0]'));
    expect(hash('2001:db8:1:3::1')).not.toBe(hash('2001:db8:1:2::1'));
  });

  it('IPv4-mapped addresses hash as IPv4', () => {
    const hash = (addr: string): string => keyedHash(ring, { kind: 'addr', addr, now: NOW });
    expect(hash('::ffff:203.0.113.7')).toBe(hash('203.0.113.7'));
    expect(hash('[::ffff:cb00:7107]')).toBe(hash('203.0.113.7'));
    expect(hash(' 203.000.113.007 ')).toBe(hash('203.0.113.7'));
  });

  it('an unparseable address still hashes', () => {
    const hash = (addr: string): string => keyedHash(ring, { kind: 'addr', addr, now: NOW });
    const inputs = ['not-an-ip', '999.0.0.1', '1:2:3', '1::2::3', '1.2.3.4::1', ':::', ''];
    for (const input of inputs) {
      expect(() => hash(input)).not.toThrow();
      expect(hash(input)).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(hash(' NOT-AN-IP ')).toBe(hash('not-an-ip'));
  });
});

describe('random secrets and comparison', () => {
  it('randomToken is 43 characters of base64url and differs between calls', () => {
    const first = randomToken();
    const second = randomToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
  });

  it('newEmailCode is six digits', () => {
    for (let i = 0; i < 1000; i += 1) {
      expect(newEmailCode()).toMatch(/^[0-9]{6}$/);
    }
  });

  it('sha256Hex is the lower-case hex digest', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('safeEqualHex', () => {
    const a = sha256Hex('a');
    expect(safeEqualHex(a, a)).toBe(true);
    expect(safeEqualHex(a, `${a.slice(0, -1)}${a.endsWith('0') ? '1' : '0'}`)).toBe(false);
    expect(safeEqualHex(a, a.slice(1))).toBe(false);
    expect(safeEqualHex('zz', 'zz')).toBe(false);
    expect(safeEqualHex('', '')).toBe(false);
  });
});

describe('the key ring', () => {
  it('loadKeyRing refuses a short secret without echoing it', () => {
    const short = '7'.repeat(63);
    expect(() => loadKeyRing(short, null)).toThrow(RangeError);
    expect(() => loadKeyRing(short, null)).toThrow(/^APP_SECRET must be/);
    expect(() => loadKeyRing(ZERO_SECRET, short)).toThrow(/^APP_SECRET_PREVIOUS must be/);
    for (const [secret, previous] of [
      [short, null],
      [ZERO_SECRET, short],
    ] as const) {
      try {
        loadKeyRing(secret, previous);
        expect.unreachable();
      } catch (err) {
        const message = err instanceof Error ? err.message : '';
        expect(message).not.toContain(short);
        expect(message).not.toContain('7777');
      }
    }
    expect(() => loadKeyRing('g'.repeat(64), null)).toThrow(RangeError);
    expect(() => loadKeyRing(ZERO_SECRET, '')).toThrow(RangeError);
  });

  it('an upper-case secret derives the same keys', () => {
    const upper = loadKeyRing('A'.repeat(64), null);
    expect(keyHex(upper.current, 'link-signing')).toBe(
      keyHex(loadKeyRing(SECRET_A, null).current, 'link-signing'),
    );
  });

  it('a key ring serialises without key material', () => {
    const rotated = loadKeyRing(SECRET_B, ZERO_SECRET);
    const json = JSON.stringify(rotated);
    const previous = rotated.previous;
    expect(previous).not.toBeNull();
    for (const label of LABELS) {
      expect(json).not.toContain(keyHex(rotated.current, label));
      if (previous !== null) {
        expect(json).not.toContain(keyHex(previous, label));
      }
    }
    expect(json).toContain(rotated.current['link-signing'].kid);
    expect(Object.isFrozen(rotated)).toBe(true);
    expect(Object.isFrozen(rotated.current)).toBe(true);
    expect(Object.isFrozen(rotated.current['identity-hash'])).toBe(true);
  });

  it("SignedPurpose lists the registry's four purposes", () => {
    const lifetimes = (purpose: SignedPurpose): number => {
      switch (purpose) {
        case 'search':
          return 1800;
        case 'unsubscribe':
          return 31_536_000;
        case 'apple_state':
          return 600;
        case 'public_form':
          return 7200;
        default:
          return assertNever(purpose);
      }
    };
    const purposes: SignedPurpose[] = ['search', 'unsubscribe', 'apple_state', 'public_form'];
    for (const purpose of purposes) {
      const token = signToken(ring, purpose, {}, lifetimes(purpose), NOW);
      expect(verifyToken(ring, purpose, token, NOW)).toEqual({});
    }
  });
});
