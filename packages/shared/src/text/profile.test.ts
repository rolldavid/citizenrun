import { describe, expect, it } from 'vitest';
import { BIO_MAX } from '../constants/accounts.ts';
import { normalizeDisplayName } from '../policy/display-name.ts';
import {
  appleDisplayName,
  normalizeBio,
  normalizeProfileLink,
  normalizeProfileName,
} from './profile.ts';

// Invisible characters are built from their code points, so none sits in this file as a raw character.
const chars = (...codePoints: number[]): string => String.fromCodePoint(...codePoints);
const ZWSP = chars(0x200b);

describe('normalizeBio', () => {
  it('bio keeps single and double line feeds and collapses more', () => {
    expect(normalizeBio('a\n\n\n\nb')).toEqual({ ok: true, value: 'a\n\nb' });
    expect(normalizeBio('a\nb\n\nc')).toEqual({ ok: true, value: 'a\nb\n\nc' });
    expect(normalizeBio('a\r\n\r\n\r\nb')).toEqual({ ok: true, value: 'a\n\nb' });
  });

  it('bio removes control, zero-width and bidirectional characters', () => {
    const raw = [
      'a',
      chars(0x000d),
      'b',
      chars(0x0007),
      'c',
      chars(0x200b),
      'd',
      chars(0xfeff),
      'e',
      chars(0x202e),
      'f',
      chars(0x2066),
      'g',
      chars(0x000a),
      'h',
      chars(0x200c, 0x200d, 0x2060, 0x200e, 0x200f, 0x061c, 0x202a, 0x2069),
      'i',
    ].join('');
    expect(normalizeBio(raw)).toEqual({ ok: true, value: 'abcdefg\nhi' });
  });

  it('bio is NFC', () => {
    const result = normalizeBio(`e${chars(0x0301)}`);
    expect(result).toEqual({ ok: true, value: chars(0x00e9) });
    expect(result.ok && result.value !== null ? Array.from(result.value) : []).toHaveLength(1);
  });

  it('bio at 160 code points passes and at 161 is too long', () => {
    expect(BIO_MAX).toBe(160);
    // Astral characters count once each, though each is two UTF-16 units.
    const atLimit = chars(0x1f600).repeat(160);
    expect(normalizeBio(atLimit)).toEqual({ ok: true, value: atLimit });
    expect(normalizeBio(`${atLimit}a`)).toEqual({ ok: false, error: 'too_long' });
  });

  it('an empty bio is null', () => {
    expect(normalizeBio('')).toEqual({ ok: true, value: null });
    expect(normalizeBio(` \n\n${ZWSP}\n `)).toEqual({ ok: true, value: null });
  });

  it('null stays null', () => {
    expect(normalizeBio(null)).toEqual({ ok: true, value: null });
  });
});

describe('normalizeProfileName', () => {
  it('a 51-code-point name is too long', () => {
    expect(normalizeProfileName('n'.repeat(51))).toEqual({ ok: false, error: 'too_long' });
    expect(normalizeProfileName('n'.repeat(50))).toEqual({ ok: true, value: 'n'.repeat(50) });
  });

  it('name normalisation follows L-display-name', () => {
    const raws = [
      '  Jane   Doe ',
      `Jane Doe ${chars(0x2713)}`,
      `Jane${chars(0x202e)}eoD`,
      chars(0xff2a, 0xff41, 0xff4e, 0xff45),
      ZWSP,
    ];
    for (const raw of raws) {
      expect(normalizeProfileName(raw)).toEqual({ ok: true, value: normalizeDisplayName(raw) });
    }
    expect(normalizeProfileName(`Jane Doe ${chars(0x2713)}`)).toEqual({
      ok: true,
      value: 'Jane Doe',
    });
    expect(normalizeProfileName(ZWSP)).toEqual({ ok: true, value: null });
  });

  it('null stays null', () => {
    expect(normalizeProfileName(null)).toEqual({ ok: true, value: null });
  });
});

describe('normalizeProfileLink', () => {
  it('link', () => {
    expect(normalizeProfileLink('https://Example.org/x')).toEqual({
      ok: true,
      value: 'https://example.org/x',
    });
    const long = `https://example.org/${'a'.repeat(201 - 'https://example.org/'.length)}`;
    expect(long).toHaveLength(201);
    for (const raw of ['http://example.org', 'https://user:pw@example.org', long]) {
      expect(normalizeProfileLink(raw), raw).toEqual({ ok: false, error: 'invalid_format' });
    }
    expect(normalizeProfileLink(null)).toEqual({ ok: true, value: null });
  });
});

describe('appleDisplayName', () => {
  it('apple name', () => {
    expect(appleDisplayName('Jane', 'Doe')).toEqual({ ok: true, value: 'Jane Doe' });
    expect(appleDisplayName('Jane', null)).toEqual({ ok: true, value: 'Jane' });
    expect(appleDisplayName(null, 'Doe')).toEqual({ ok: true, value: 'Doe' });
    expect(appleDisplayName(null, null)).toEqual({ ok: true, value: null });
    expect(appleDisplayName(`Ja${ZWSP}ne${chars(0x2714)}`, 'Doe')).toEqual({
      ok: true,
      value: 'Jane Doe',
    });
  });

  it('a name over the limit is too long', () => {
    expect(appleDisplayName('g'.repeat(30), 'f'.repeat(30))).toEqual({
      ok: false,
      error: 'too_long',
    });
  });
});
