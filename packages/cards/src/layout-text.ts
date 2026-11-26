import { FONT_FILES } from '@citizenrun/shared';
import { CAP_HEIGHT, round1 } from './canvas.ts';
import fontMetrics from './font-metrics.json' with { type: 'json' };
import type { FontFace } from './primitives/types.ts';

// CARD-layout-text (D-272): pure measuring, wrapping, fitting and cutting over the committed advance
// widths, so the app and the server break every line in the same place. Every width is in canvas
// units; a size is in canvas units per em.

export type FaceMetrics = {
  unitsPerEm: 1000;
  capHeight: number;
  xHeight: number;
  ascent: number;
  descent: number;
  /** One entry per code point of the file's cmap, keyed by the character; font units. */
  advances: Record<string, number>;
};
export type FontMetrics = Record<
  'SpecialGothic-Regular' | 'SpecialGothic-Medium' | 'SpecialGothic-Bold' | 'ChivoMono-Medium',
  FaceMetrics
>;

/** A face, a size in units and a tracking in em (default 0). */
export type TextStyle = { face: FontFace; size: number; tracking?: number };

const METRICS = fontMetrics as FontMetrics;
const ELLIPSIS = '…';
const FALLBACK = 'n';

let strictGlyphs = false;

/** Thrown under strict glyphs when a code point has no advance in the face; the message names it as U+XXXX. */
export class UndrawableTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UndrawableTextError';
  }
}

/** Turns the strict glyph check on or off; off by default, on in every test that lays out text. */
export function setStrictGlyphs(on: boolean): void {
  strictGlyphs = on;
}

/** The advance widths of a face in font units, keyed by the character. */
export function faceAdvances(face: FontFace): Readonly<Record<string, number>> {
  return METRICS[FONT_FILES[face]].advances;
}

/** NFC, every run of white space as one space, the ends trimmed. */
function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function codePointName(ch: string): string {
  return `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`;
}

/** The width of already normalized text in units. */
function widthOf(text: string, face: FontFace, size: number, tracking: number): number {
  const advances = faceAdvances(face);
  let total = 0;
  let count = 0;
  for (const ch of text) {
    count += 1;
    if (Object.hasOwn(advances, ch)) {
      total += advances[ch] ?? 0;
      continue;
    }
    if (strictGlyphs) {
      throw new UndrawableTextError(
        `${codePointName(ch)} cannot be drawn in the ${face} face; fold the text first`,
      );
    }
    total += advances[FALLBACK] ?? 0;
  }
  return (total * size) / 1000 + tracking * size * Math.max(0, count - 1);
}

/** The text cut to maxWidth: code points off the end until it fits with the ellipsis (D-272). */
function cutLine(line: string, fits: (text: string) => boolean): string {
  const points = Array.from(line);
  while (points.length > 0 && !fits(points.join('') + ELLIPSIS)) {
    points.pop();
  }
  return points.join('').replace(/ +$/u, '') + ELLIPSIS;
}

/**
 * Width in units: the sum of advances x size / 1000, plus tracking x size between code points. The
 * tracking is used as given, negative included; an empty string is 0 wide.
 */
export function measureText(text: string, style: TextStyle): number {
  return widthOf(normalizeText(text), style.face, style.size, style.tracking ?? 0);
}

/**
 * Greedy wrap at spaces into lines no wider than maxWidth units; the last line ends in an ellipsis
 * when the text needs more than maxLines, and a word wider than maxWidth is cut on its own line
 * (D-272). An empty string gives no lines.
 */
export function layoutText(
  text: string,
  style: TextStyle,
  maxWidth: number,
  maxLines: number,
): { lines: string[]; cut: boolean } {
  const normalized = normalizeText(text);
  if (normalized === '') return { lines: [], cut: false };
  const tracking = Math.max(0, style.tracking ?? 0);
  const fits = (line: string): boolean =>
    widthOf(line, style.face, style.size, tracking) <= maxWidth;

  const wrapped: string[] = [];
  let current = '';
  for (const word of normalized.split(' ')) {
    if (current === '') {
      current = word;
    } else if (fits(`${current} ${word}`)) {
      current = `${current} ${word}`;
    } else {
      wrapped.push(current);
      current = word;
    }
  }
  wrapped.push(current);

  const limit = Math.max(1, Math.floor(maxLines));
  let cut = false;
  const fitted = (line: string): string => {
    if (fits(line)) return line;
    cut = true;
    return cutLine(line, fits);
  };
  if (wrapped.length <= limit) {
    const lines = wrapped.map(fitted);
    return { lines, cut };
  }
  const lines = wrapped.slice(0, limit - 1).map(fitted);
  lines.push(cutLine(wrapped.slice(limit - 1).join(' '), fits));
  return { lines, cut: true };
}

/**
 * The first of sizes (units) at which the text fits maxWidth units on one line, measured at zero
 * or positive tracking only; the last size when none does, and the first for an empty string.
 */
export function fitOneLine(
  text: string,
  face: FontFace,
  sizes: readonly number[],
  maxWidth: number,
  tracking?: number,
): number {
  const normalized = normalizeText(text);
  const measured = Math.max(0, tracking ?? 0);
  for (const size of sizes) {
    if (widthOf(normalized, face, size, measured) <= maxWidth) return size;
  }
  const last = sizes.at(-1);
  if (last === undefined) throw new RangeError('fitOneLine needs at least one size.');
  return last;
}

/**
 * The first [size, maxLines] step at which the text wraps within maxWidth units without a cut;
 * else the last step's layout, cut. An empty string fits the first step with no lines.
 */
export function fitWrapped(
  text: string,
  face: FontFace,
  steps: readonly (readonly [number, number])[],
  maxWidth: number,
  tracking?: number,
): { size: number; lines: string[]; cut: boolean } {
  const measured = Math.max(0, tracking ?? 0);
  for (const [size, maxLines] of steps) {
    const layout = layoutText(text, { face, size, tracking: measured }, maxWidth, maxLines);
    if (
      !layout.cut &&
      layout.lines.every((line) => widthOf(line, face, size, measured) <= maxWidth)
    ) {
      return { size, ...layout };
    }
  }
  const last = steps.at(-1);
  if (last === undefined) throw new RangeError('fitWrapped needs at least one step.');
  const [size, maxLines] = last;
  return { size, ...layoutText(text, { face, size, tracking: measured }, maxWidth, maxLines) };
}

/**
 * The largest whole size from min to max (units) at which a Bold figure is no wider than maxWidth
 * units; never under min, and max for an empty string.
 */
export function fitNumber(
  text: string,
  maxWidth: number,
  limits: { min: number; max: number },
): number {
  const unit = measureText(text, { face: 'bold', size: 1 });
  return Math.max(limits.min, Math.min(limits.max, Math.floor(maxWidth / unit)));
}

/** One line cut to maxWidth units with an ellipsis; the whole normalized text when it fits, empty for an empty string. */
export function clipText(text: string, style: TextStyle, maxWidth: number): string {
  const normalized = normalizeText(text);
  if (normalized === '') return '';
  const tracking = Math.max(0, style.tracking ?? 0);
  const fits = (line: string): boolean =>
    widthOf(line, style.face, style.size, tracking) <= maxWidth;
  return fits(normalized) ? normalized : cutLine(normalized, fits);
}

/** The first baseline of a block whose cap top is at capTop units, set at size units. */
export function baselineFromCapTop(capTop: number, size: number): number {
  return round1(capTop + CAP_HEIGHT * size);
}
