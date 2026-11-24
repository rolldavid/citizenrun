// Declared contrast pairs (DS-contrast). The functions that check them live beside them.
import type { ColorToken } from './tokens.ts';

const HEX = /^#[0-9A-Fa-f]{6}$/;

function parseHex(hex: string): [number, number, number] {
  if (!HEX.test(hex)) {
    throw new Error(`Expected #RRGGBB, got ${hex}`);
  }
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

/** One sRGB channel (0 to 255) as linear light (0 to 1). */
function linear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(linear) as [number, number, number]; // map keeps the three channels
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio of two opaque colors given as #RRGGBB. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** A color at an alpha over an opaque ground, channel by channel, as #RRGGBB. */
export function blend(fg: string, alpha: number, bg: string): string {
  const front = parseHex(fg);
  const back = parseHex(bg);
  return `#${front
    .map((channel, index) => Math.round(alpha * channel + (1 - alpha) * (back[index] ?? 0)))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/** OKLab coordinates and OKLCH chroma and hue of an sRGB hex color. */
export function oklab(hex: string): {
  L: number;
  a: number;
  b: number;
  chroma: number;
  hue: number;
} {
  const [r, g, b] = parseHex(hex).map(linear) as [number, number, number]; // map keeps the three channels
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return {
    L,
    a: A,
    b: B,
    chroma: Math.hypot(A, B),
    hue: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360,
  };
}

/** Euclidean distance in OKLab. */
export function oklabDistance(a: string, b: string): number {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

/** Text pairs: [text token, ground token]. Each must be at least 4.5:1 in both themes. */
export const TEXT_PAIRS: readonly (readonly [ColorToken, ColorToken])[] = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'well'],
  ['noticeText', 'bg'],
  ['noticeText', 'surface'],
  ['noticeText', 'well'],
  ['linkText', 'bg'],
  ['linkText', 'surface'],
  ['linkText', 'well'],
  ['textSecondary', 'bg'],
  ['textSecondary', 'surface'],
  ['textSecondary', 'well'],
  ['disabledText', 'bg'],
  ['disabledText', 'surface'],
  ['disabledText', 'well'],
  ['onAccent', 'accent'],
  ['onAccent', 'accentHover'],
  ['onHighlight', 'highlight'],
  ['danger', 'bg'],
  ['danger', 'surface'],
  ['danger', 'well'],
  ['success', 'bg'],
  ['success', 'surface'],
  ['success', 'well'],
  ['inverseText', 'inverseBg'],
  ['inverseText', 'inverseHover'],
  ['selectedText', 'inverseBg'],
  ['selectedText', 'inverseHover'],
  ['inverseTextSecondary', 'inverseBg'],
  ['posterText', 'posterBg'],
  ['posterTextSecondary', 'posterBg'],
  ['mapLabel', 'mapLabelHalo'],
  ['mapLabelSecondary', 'mapLabelHalo'],
  ['bubbleText', 'bubbleBg'],
  // mediaControlBg is translucent: the check blends it over white and over black
  ['onMediaControl', 'mediaControlBg'],
];

/** Marks and control outlines: each must be at least 3:1 in both themes. */
export const MARK_PAIRS: readonly (readonly [ColorToken, ColorToken])[] = [
  ['accent', 'bg'],
  ['accent', 'surface'],
  ['accentHover', 'bg'],
  ['accent', 'text'], // the spot on ink
  ['accent', 'posterBg'],
  ['rule', 'bg'],
  ['rule', 'surface'],
  ['rule', 'hoverBg'],
  ['focusRing', 'bg'],
  ['focusRing', 'surface'],
  ['textSecondary', 'bg'], // unlit pip and tick outlines
  ['textSecondary', 'surface'],
  ['danger', 'surface'], // field borders
  ['success', 'surface'],
  ['mapNoDataLine', 'mapNoData'],
];

/** For the "every text token is paired" case: each text token and every ground it may sit on. */
export const TEXT_GROUNDS: Readonly<Partial<Record<ColorToken, readonly ColorToken[]>>> = {
  text: ['bg', 'surface', 'well'],
  noticeText: ['bg', 'surface', 'well'],
  linkText: ['bg', 'surface', 'well'],
  textSecondary: ['bg', 'surface', 'well'],
  disabledText: ['bg', 'surface', 'well'],
  onAccent: ['accent', 'accentHover'],
  onHighlight: ['highlight'],
  danger: ['bg', 'surface', 'well'],
  success: ['bg', 'surface', 'well'],
  inverseText: ['inverseBg', 'inverseHover'],
  selectedText: ['inverseBg', 'inverseHover'],
  inverseTextSecondary: ['inverseBg'],
  posterText: ['posterBg'],
  posterTextSecondary: ['posterBg'],
  mapLabel: ['mapLabelHalo'],
  mapLabelSecondary: ['mapLabelHalo'],
  bubbleText: ['bubbleBg'],
  onMediaControl: ['mediaControlBg'],
};
