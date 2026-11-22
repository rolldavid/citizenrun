/** The four bundled faces. The value is the file name without extension, which is also the PostScript name. */
export const FONT_FILES = {
  regular: 'SpecialGothic-Regular',
  medium: 'SpecialGothic-Medium',
  bold: 'SpecialGothic-Bold',
  mono: 'ChivoMono-Medium',
} as const;
export type FontFace = keyof typeof FONT_FILES;

/** How the same faces are named in plain CSS and in SVG (family plus weight). */
export const FONT_CSS = {
  regular: { family: 'Special Gothic', weight: 400 },
  medium: { family: 'Special Gothic', weight: 500 },
  bold: { family: 'Special Gothic', weight: 700 },
  mono: { family: 'Chivo Mono', weight: 500 },
} as const;

export const FONT_STACKS = {
  sans: '"Special Gothic", "Special Gothic Fallback", "Helvetica Neue", Arial, sans-serif',
  mono: '"Chivo Mono", ui-monospace, Menlo, Consolas, monospace',
} as const;

/** Arial with metric overrides, so the swap on a server page does not move the layout. Percentages. */
export const FONT_FALLBACK_METRICS = {
  regular: { sizeAdjust: 94.5, ascentOverride: 106.3, descentOverride: 31.2 },
  medium: { sizeAdjust: 97.7, ascentOverride: 102.9, descentOverride: 30.2 },
  bold: { sizeAdjust: 100.8, ascentOverride: 99.7, descentOverride: 29.3 },
} as const;

/** Part of the web font URL. Raise it whenever a font file changes. */
export const FONT_VERSION = '1';
export const FONT_URL_BASE = `/fonts/${FONT_VERSION}`;

export type TypeRole =
  | 'display'
  | 'title'
  | 'heading'
  | 'body'
  | 'bodyStrong'
  | 'label'
  | 'caption'
  | 'captionStrong'
  | 'monoLabel'
  | 'mono'
  | 'numeralHero'
  | 'numeralDisplay'
  | 'numeralTitle'
  | 'numeralHeading'
  | 'initialsSm'
  | 'initialsMd'
  | 'initialsLg';

export type TypeRoleSpec = {
  face: FontFace;
  size: number; // points on phones, CSS pixels on the web
  lineHeight: number;
  tracking: number; // em
  uppercase: boolean; // drawn in capitals
  capped: boolean; // stops growing at textScale.maxLargeRoles
};

export const typeRoles: Readonly<Record<TypeRole, TypeRoleSpec>> = {
  display: {
    face: 'medium',
    size: 40,
    lineHeight: 44,
    tracking: -0.02,
    uppercase: false,
    capped: true,
  },
  title: {
    face: 'medium',
    size: 28,
    lineHeight: 32,
    tracking: -0.015,
    uppercase: false,
    capped: true,
  },
  heading: {
    face: 'medium',
    size: 20,
    lineHeight: 26,
    tracking: -0.01,
    uppercase: false,
    capped: false,
  },
  body: { face: 'regular', size: 16, lineHeight: 22, tracking: 0, uppercase: false, capped: false },
  bodyStrong: {
    face: 'medium',
    size: 16,
    lineHeight: 22,
    tracking: 0,
    uppercase: false,
    capped: false,
  },
  label: { face: 'medium', size: 14, lineHeight: 18, tracking: 0, uppercase: false, capped: false },
  caption: {
    face: 'regular',
    size: 13,
    lineHeight: 18,
    tracking: 0,
    uppercase: false,
    capped: false,
  },
  captionStrong: {
    face: 'medium',
    size: 13,
    lineHeight: 18,
    tracking: 0,
    uppercase: false,
    capped: false,
  },
  monoLabel: {
    face: 'mono',
    size: 12,
    lineHeight: 16,
    tracking: 0.04,
    uppercase: true,
    capped: false,
  },
  mono: { face: 'mono', size: 12, lineHeight: 16, tracking: 0, uppercase: false, capped: false },
  numeralHero: {
    face: 'bold',
    size: 56,
    lineHeight: 56,
    tracking: -0.03,
    uppercase: false,
    capped: true,
  },
  numeralDisplay: {
    face: 'bold',
    size: 40,
    lineHeight: 44,
    tracking: -0.03,
    uppercase: false,
    capped: true,
  },
  numeralTitle: {
    face: 'bold',
    size: 28,
    lineHeight: 32,
    tracking: -0.03,
    uppercase: false,
    capped: true,
  },
  numeralHeading: {
    face: 'bold',
    size: 20,
    lineHeight: 26,
    tracking: -0.03,
    uppercase: false,
    capped: false,
  },
  initialsSm: {
    face: 'medium',
    size: 14,
    lineHeight: 18,
    tracking: 0,
    uppercase: true,
    capped: false,
  },
  initialsMd: {
    face: 'medium',
    size: 20,
    lineHeight: 26,
    tracking: 0,
    uppercase: true,
    capped: false,
  },
  initialsLg: {
    face: 'medium',
    size: 28,
    lineHeight: 32,
    tracking: 0,
    uppercase: true,
    capped: false,
  },
};

/**
 * Code points each face can draw, as inclusive ranges. A string with any character outside its
 * face's ranges is drawn whole in the system font in native text.
 */
export const FONT_COVERAGE: Readonly<
  Record<'sans' | 'mono', readonly (readonly [number, number])[]>
> = {
  sans: [
    [0x0020, 0x007e],
    [0x00a0, 0x00ac],
    [0x00ae, 0x0148],
    [0x014a, 0x0161],
    [0x0164, 0x017e],
    [0x2013, 0x2014],
    [0x2018, 0x201a],
    [0x201c, 0x201e],
    [0x2020, 0x2022],
    [0x2026, 0x2026],
    [0x20ac, 0x20ac],
    [0x2192, 0x2192],
  ],
  mono: [
    [0x0020, 0x007e],
    [0x00a0, 0x017f],
    [0x01a0, 0x01a1],
    [0x01af, 0x01b0],
    [0x2010, 0x2011],
    [0x2013, 0x2014],
    [0x2018, 0x201a],
    [0x201c, 0x201e],
    [0x2020, 0x2022],
    [0x2026, 0x2026],
    [0x20ac, 0x20ac],
  ],
};

/** True when every character of `text` is in the face's coverage. Pure; iterates by code point. */
export function fontCovers(face: FontFace, text: string): boolean {
  const ranges = face === 'mono' ? FONT_COVERAGE.mono : FONT_COVERAGE.sans;
  for (const ch of text) {
    const point = ch.codePointAt(0);
    // undefined only for an empty string, which the iteration never yields
    if (point === undefined) return false;
    if (!ranges.some(([first, last]) => point >= first && point <= last)) return false;
  }
  return true;
}
