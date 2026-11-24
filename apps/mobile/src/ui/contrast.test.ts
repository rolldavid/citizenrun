import {
  blend,
  contrastRatio,
  MARK_PAIRS,
  oklab,
  oklabDistance,
  TEXT_GROUNDS,
  TEXT_PAIRS,
} from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import { color, fixed, opacity } from './tokens';
import type { ColorToken, ThemeName } from './tokens';

const THEMES: readonly ThemeName[] = ['light', 'dark'];

/** A translucent token, `rgba(r,g,b,a)`, as its opaque color and its alpha. */
function parseRgba(value: string): { hex: string; alpha: number } | null {
  const match = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(value);
  if (match === null) return null;
  const [, r, g, b, a] = match;
  const hex = [r, g, b]
    .map((channel) => Number(channel).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return { hex: `#${hex}`, alpha: Number(a) };
}

/** The opaque grounds a token stands for: itself, or a translucent one over white and over black. */
function groundsOf(value: string): string[] {
  const rgba = parseRgba(value);
  if (rgba === null) return [value];
  return [blend(rgba.hex, rgba.alpha, '#FFFFFF'), blend(rgba.hex, rgba.alpha, '#000000')];
}

function ratio(theme: ThemeName, text: ColorToken, ground: ColorToken): number {
  return contrastRatio(color[theme][text], color[theme][ground]);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function failingPairs(
  pairs: readonly (readonly [ColorToken, ColorToken])[],
  minimum: number,
): string[] {
  const failures: string[] = [];
  for (const theme of THEMES) {
    for (const [fg, ground] of pairs) {
      for (const opaque of groundsOf(color[theme][ground])) {
        const value = contrastRatio(color[theme][fg], opaque);
        if (value < minimum) {
          failures.push(`${theme}: ${fg} on ${ground} (${opaque}) is ${value.toFixed(2)}`);
        }
      }
    }
  }
  return failures;
}

describe('contrast functions', () => {
  it('contrastRatio is the WCAG ratio', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBe(21);
    expect(contrastRatio('#000000', '#FFFFFF')).toBe(21);
    expect(contrastRatio('#F04E14', '#141412')).toBe(contrastRatio('#141412', '#F04E14'));
    expect(contrastRatio('#F04E14', '#F04E14')).toBe(1);
    expect(contrastRatio('#abcdef', '#ABCDEF')).toBe(1);
    expect(() => contrastRatio('#FFF', '#000000')).toThrow('Expected #RRGGBB, got #FFF');
  });

  it('blend mixes channel by channel', () => {
    expect(blend('#000000', 0.5, '#FFFFFF')).toBe('#808080');
    expect(blend('#141412', 0.8, '#FFFFFF')).toBe('#434341');
    expect(blend('#141412', 1, '#FFFFFF')).toBe('#141412');
    expect(blend('#141412', 0, '#ffffff')).toBe('#FFFFFF');
  });

  it('oklab of white and black', () => {
    const white = oklab('#FFFFFF');
    expect(Math.abs(white.L - 1)).toBeLessThan(1e-4);
    expect(Math.abs(white.a)).toBeLessThan(1e-4);
    expect(Math.abs(white.b)).toBeLessThan(1e-4);
    expect(white.chroma).toBeLessThan(1e-4);
    expect(Math.abs(oklab('#000000').L)).toBeLessThan(1e-4);
    expect(Math.abs(oklabDistance('#FFFFFF', '#000000') - 1)).toBeLessThan(1e-4);
  });

  it('oklab hue is in degrees from 0 to 360', () => {
    // The accent is an orange: a hue between red (about 29) and yellow (about 110).
    const accent = oklab('#F04E14');
    expect(accent.hue).toBeGreaterThan(29);
    expect(accent.hue).toBeLessThan(110);
    // A blue has a negative b, so its atan2 is negative before it is brought into [0, 360).
    const blue = oklab('#0000FF');
    expect(blue.hue).toBeGreaterThan(180);
    expect(blue.hue).toBeLessThan(360);
  });
});

describe('the contrast rules', () => {
  it('the published figures', () => {
    const figures: [ColorToken, ColorToken, number, number][] = [
      ['text', 'bg', 16.02, 16.59],
      ['textSecondary', 'well', 6.02, 5.91],
      ['onAccent', 'accent', 5.1, 5.1],
      ['accent', 'bg', 3.14, 5.18],
      ['success', 'well', 5.16, 7.6],
      ['danger', 'well', 5.03, 6.18],
    ];
    for (const [fg, ground, light, dark] of figures) {
      expect(round2(ratio('light', fg, ground)), `light ${fg} on ${ground}`).toBe(light);
      expect(round2(ratio('dark', fg, ground)), `dark ${fg} on ${ground}`).toBe(dark);
    }
  });

  it('every text pair is at least 4.5:1', () => {
    expect(TEXT_PAIRS.length).toBeGreaterThan(0);
    expect(failingPairs(TEXT_PAIRS, 4.5)).toEqual([]);
    // The one translucent ground is checked over both extremes of a photo.
    for (const theme of THEMES) {
      expect(groundsOf(color[theme].mediaControlBg)).toHaveLength(2);
    }
  });

  it('low-confidence text is at least 4.5:1', () => {
    for (const theme of THEMES) {
      for (const ground of ['bg', 'surface', 'well'] as const) {
        expect(ratio(theme, 'text', ground), `${theme} text on ${ground}`).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
    const names = [...Object.keys(color.light), ...Object.keys(opacity)];
    expect(names.filter((name) => /confidence|lowconf|estimate/i.test(name))).toEqual([]);
    expect(Object.keys(opacity)).toEqual([
      'mapDim',
      'skeletonLow',
      'pulseLow',
      'scrimLight',
      'scrimDark',
      'mediaControl',
    ]);
  });

  it("the accent's text is at least 4.5:1", () => {
    for (const theme of THEMES) {
      expect(ratio(theme, 'onAccent', 'accent'), theme).toBeGreaterThanOrEqual(4.5);
      expect(ratio(theme, 'onAccent', 'accentHover'), theme).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('every text token is paired', () => {
    expect(Object.keys(TEXT_GROUNDS)).toEqual([
      'text',
      'noticeText',
      'linkText',
      'textSecondary',
      'disabledText',
      'onAccent',
      'onHighlight',
      'danger',
      'success',
      'inverseText',
      'selectedText',
      'inverseTextSecondary',
      'posterText',
      'posterTextSecondary',
      'mapLabel',
      'mapLabelSecondary',
      'bubbleText',
      'onMediaControl',
    ]);
    const declared = new Set(TEXT_PAIRS.map(([fg, ground]) => `${fg} on ${ground}`));
    for (const [fg, grounds] of Object.entries(TEXT_GROUNDS)) {
      for (const ground of grounds) {
        expect(declared.has(`${fg} on ${ground}`), `${fg} on ${ground}`).toBe(true);
      }
    }
    const grounds: Readonly<Partial<Record<string, readonly string[]>>> = TEXT_GROUNDS;
    for (const [fg, ground] of TEXT_PAIRS) {
      expect(grounds[fg]?.includes(ground), `${fg} on ${ground}`).toBe(true);
    }
  });

  it('every mark pair is at least 3:1', () => {
    expect(MARK_PAIRS.length).toBeGreaterThan(0);
    expect(failingPairs(MARK_PAIRS, 3)).toEqual([]);
  });

  it('email pairs are at least 4.5:1', () => {
    expect(contrastRatio(fixed.ink, fixed.emailBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(color.light.textSecondary, fixed.emailBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fixed.bone, fixed.ink)).toBeGreaterThanOrEqual(4.5);
  });

  it('the notification tint is at least 3:1', () => {
    expect(contrastRatio(fixed.notificationTint, color.light.bg)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(fixed.notificationTint, color.dark.bg)).toBeGreaterThanOrEqual(3);
  });
});
