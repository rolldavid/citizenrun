import { describe, expect, it } from 'vitest';
import type { FontFace } from '../primitives/types.ts';
import { canDraw, foldForCanvas } from './fold.ts';

const FACES: readonly FontFace[] = ['regular', 'medium', 'bold', 'mono'];

describe('fold table', () => {
  it('folds an accented letter to its base letter', () => {
    expect(canDraw('Nguyễn', 'medium')).toBe(false);
    expect(foldForCanvas('Nguyễn', 'medium')).toBe('Nguyen');
    expect(canDraw('Nguyen', 'medium')).toBe(true);
  });

  it('keeps a letter the face has', () => {
    // Chivo Mono has the Vietnamese letters, so nothing is folded there.
    expect(foldForCanvas('Nguyễn', 'mono')).toBe('Nguyễn');
    expect(foldForCanvas('Niño', 'medium')).toBe('Niño');
    expect(canDraw('Niño', 'medium')).toBe(true);
  });

  it('turns the okina into a quotation mark', () => {
    for (const face of ['medium', 'mono'] as const) {
      expect(canDraw('Hawaiʻi', face), face).toBe(false);
      expect(foldForCanvas('Hawaiʻi', face), face).toBe('Hawai‘i');
      expect(canDraw('Hawai‘i', face), face).toBe(true);
    }
  });

  it('keeps or folds the modifier apostrophe', () => {
    expect(foldForCanvas('Haleʼiwa', 'mono')).toBe('Haleʼiwa');
    expect(foldForCanvas('Haleʼiwa', 'medium')).toBe('Hale’iwa');
  });

  it('removes what cannot be folded', () => {
    expect(foldForCanvas('\u{1F642}\u{1F3DB}️\u{1F5F3}', 'medium')).toBe('');
    expect(foldForCanvas('Ann  \u{1F642}  Lee', 'medium')).toBe('Ann Lee');
    expect(foldForCanvas('County\n\tTreasurer ✓', 'bold')).toBe('County Treasurer');
  });

  it('normalizes to NFC first', () => {
    expect(foldForCanvas('Niño', 'medium')).toBe('Niño');
    expect(canDraw('Niño', 'medium')).toBe(true);
  });

  it('every fold result is drawable', () => {
    const samples = [
      'Nguyễn',
      'Hawaiʻi',
      'Haleʼiwa',
      'Ann  \u{1F642}  Lee',
      '\u{1F642}\u{1F642}',
      'Fixture Đà Nẵng → ✓',
      'Niño',
    ];
    for (const face of FACES) {
      for (const text of samples) {
        expect(canDraw(foldForCanvas(text, face), face), `${face}: ${text}`).toBe(true);
      }
    }
  });

  it('a handle is always drawable in the mono', () => {
    expect(canDraw('@carol_wynn.2', 'mono')).toBe(true);
    expect(canDraw('@abcdefghijklmnopqrstuvwxyz_0123456789.', 'mono')).toBe(true);
  });
});
