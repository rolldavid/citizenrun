import { describe, expect, it } from 'vitest';
import { DISPLAY_NAME_MAX, normalizeDisplayName } from './display-name.ts';

// Invisible and look-alike characters are built from their code points, so none sits in this file
// as a raw character.
const char = (codePoint: number): string => String.fromCodePoint(codePoint);
const ZWSP = char(0x200b);
const RLO = char(0x202e);
const CHECK = char(0x2713);

describe('normalizeDisplayName fixture rows', () => {
  it('  Jane   Doe ', () => {
    expect(normalizeDisplayName('  Jane   Doe ')).toBe('Jane Doe');
  });
  it('Jane Doe ✓', () => {
    expect(normalizeDisplayName(`Jane Doe ${CHECK}`)).toBe('Jane Doe');
  });
  it('Jane + U+202E + eoD', () => {
    expect(normalizeDisplayName(`Jane${RLO}eoD`)).toBe('JaneeoD');
  });
  it('full-width Jane', () => {
    const fullWidth = [0xff2a, 0xff41, 0xff4e, 0xff45].map(char).join('');
    expect(normalizeDisplayName(fullWidth)).toBe('Jane');
  });
  it('a lone U+200B', () => {
    expect(normalizeDisplayName(ZWSP)).toBeNull();
  });
  it('a letter followed by U+FE0F', () => {
    expect(normalizeDisplayName(`J${char(0xfe0f)}`)).toBe('J');
  });
  it('U+E000', () => {
    expect(normalizeDisplayName(`Ja${char(0xe000)}ne`)).toBe('Jane');
  });
  it('51 code points after normalization', () => {
    expect(() => normalizeDisplayName('a'.repeat(51))).toThrow(new RangeError('too_long'));
  });
});

describe('impersonation controls', () => {
  it('a right-to-left override is removed', () => {
    expect(normalizeDisplayName(`${RLO}Jane Doe`)).toBe('Jane Doe');
  });

  it('a check mark is removed', () => {
    for (const codePoint of [0x2611, 0x2705, 0x2713, 0x2714, 0x1f5f8]) {
      expect(normalizeDisplayName(`Jane ${char(codePoint)}`), codePoint.toString(16)).toBe('Jane');
    }
  });

  it('every badge-like glyph is removed', () => {
    const glyphs = [
      0x2611, 0x2605, 0x2606, 0x2705, 0x2713, 0x2714, 0x272a, 0x272f, 0x2730, 0x1f512, 0x1f5f8,
      0x1f6e1,
    ].map(char);
    expect(normalizeDisplayName(`Ja${glyphs.join('')}ne`)).toBe('Jane');
  });

  it('51 code points are refused', () => {
    // Ten mathematical bold capitals become ten plain letters under NFKC: 51 code points after it.
    const raw = char(0x1d400).repeat(10) + 'a'.repeat(41);
    expect(() => normalizeDisplayName(raw)).toThrow(RangeError);
    expect(() => normalizeDisplayName(raw)).toThrow(/^too_long$/);
  });

  it('50 code points pass', () => {
    expect(DISPLAY_NAME_MAX).toBe(50);
    const name = 'b'.repeat(50);
    expect(normalizeDisplayName(name)).toBe(name);
  });

  it('a long raw name that normalises under the limit is neither refused nor cut', () => {
    expect(normalizeDisplayName(`${ZWSP.repeat(30)}${'c'.repeat(50)}`)).toBe('c'.repeat(50));
  });
});

describe('names are normalised', () => {
  it('names are normalised', () => {
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMN';
    expect(letters).toHaveLength(40);
    const noise = [0x200b, 0x202e, 0x0007, 0x2066, 0x200d, 0xfeff, 0x0001, 0x2069].map(char);
    let raw = '';
    for (let index = 0; index < letters.length; index += 1) {
      raw += letters.charAt(index);
      if (index % 2 === 0) {
        raw += noise[index % noise.length] ?? '';
      }
    }
    expect(Array.from(raw)).toHaveLength(60);
    expect(normalizeDisplayName(raw)).toBe(letters);
  });

  it('a soft hyphen is removed', () => {
    expect(normalizeDisplayName(`Ja${char(0x00ad)}ne`)).toBe('Jane');
  });

  it('a lone surrogate is removed', () => {
    expect(normalizeDisplayName(`Ja${char(0xd800)}ne`)).toBe('Jane');
  });

  it('whitespace runs of any kind become one space', () => {
    expect(normalizeDisplayName(`Jane${char(0x00a0)}${char(0x2003)} Doe`)).toBe('Jane Doe');
  });
});
