import { describe, expect, it } from 'vitest';
import { mapperFor } from './index.ts';
import { numberedGeoid } from './numbered.ts';

describe('numberedGeoid', () => {
  it('pads a number to three characters after the state code', () => {
    expect(numberedGeoid('08', '21')).toBe('08021');
  });

  it('pads a lettered label', () => {
    expect(numberedGeoid('27', '1A')).toBe('2701A');
  });

  it('gives null for a named district', () => {
    expect(numberedGeoid('25', '7th Hampden')).toBeNull();
  });

  it('gives null for an empty label', () => {
    expect(numberedGeoid('08', '')).toBeNull();
  });

  it('trims the label first', () => {
    expect(numberedGeoid('08', ' 3 ')).toBe('08003');
  });

  it('upper-cases a lettered label and keeps a three-character code', () => {
    expect(numberedGeoid('27', '1a')).toBe('2701A');
    expect(numberedGeoid('48', '150')).toBe('48150');
    expect(numberedGeoid('48', '1500')).toBeNull();
  });
});

describe('mapperFor', () => {
  it('uses the numbered mapper for both chambers', () => {
    const map = mapperFor('CO', '08');
    expect(map('upper', '21')).toBe('08021');
    expect(map('lower', '65')).toBe('08065');
  });
});
