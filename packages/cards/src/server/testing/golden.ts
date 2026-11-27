import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from 'node:process';
import { color, createI18n, issue } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { expect } from 'vitest';
import { canvasColorsFrom } from '../../colors.ts';
import type { CanvasColors, CardTheme } from '../../colors.ts';
import { renderCardPng } from '../render-png.ts';

// The golden-file helpers of the card tests (CARD-tests): the committed fonts, the golden folder,
// the image tolerance, the plain-canvas markup scan, the two card themes and the two locales.

export const FONT_DIR = join(import.meta.dirname, '../../../assets/fonts');
const GOLDEN_DIR = join(import.meta.dirname, '../../__golden__');

/** Golden files are rewritten only when the run sets UPDATE_GOLDEN=1; the difference is read before it is committed. */
export const updateGolden = env.UPDATE_GOLDEN === '1';

function missingGolden(name: string): Error {
  return new Error(
    `Golden file ${name} is missing; run the test once with UPDATE_GOLDEN=1 and read the result before committing`,
  );
}

/** The golden text `name`: written from `actual` under UPDATE_GOLDEN=1, read otherwise. */
export function goldenText(name: string, actual: string): string {
  const path = join(GOLDEN_DIR, name);
  if (updateGolden) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(path, actual);
    return actual;
  }
  if (!existsSync(path)) {
    throw missingGolden(name);
  }
  return readFileSync(path, 'utf8');
}

/** The golden bytes `name`: written from `actual` under UPDATE_GOLDEN=1, read otherwise. */
export function goldenBytes(name: string, actual: Uint8Array): Uint8Array {
  const path = join(GOLDEN_DIR, name);
  if (updateGolden) {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(path, actual);
    return actual;
  }
  if (!existsSync(path)) {
    throw missingGolden(name);
  }
  return new Uint8Array(readFileSync(path));
}

/** The share of pixels where any of the four RGBA channels differs by more than 8 of 255 (D-100). */
export async function pixelDiffRatio(a: Uint8Array, b: Uint8Array): Promise<number> {
  const [left, right] = await Promise.all(
    [a, b].map((bytes) => sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })),
  );
  if (left === undefined || right === undefined) {
    throw new Error('an image did not decode');
  }
  if (left.info.width !== right.info.width || left.info.height !== right.info.height) {
    throw new Error(
      `the images differ in size: ${String(left.info.width)}x${String(left.info.height)} and ${String(right.info.width)}x${String(right.info.height)}`,
    );
  }
  const pixels = left.info.width * left.info.height;
  let differing = 0;
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    for (let channel = 0; channel < 4; channel += 1) {
      const index = pixel * 4 + channel;
      if (Math.abs((left.data[index] ?? 0) - (right.data[index] ?? 0)) > 8) {
        differing += 1;
        break;
      }
    }
  }
  return differing / pixels;
}

// React escapes `<`, `>` and `"` inside attribute values and text, so in its markup every `<` opens a
// tag and every attribute value is double-quoted.
const OPENING_TAG = /<([a-zA-Z]+)\b([^>]*)>/g;
const ATTRIBUTE = /([^\s=/]+)(?:="([^"]*)")?/g;

export type ScannedTag = { name: string; attributes: Map<string, string> };

/** Every opening tag of `markup`, with its attributes. */
export function scanTags(markup: string): ScannedTag[] {
  return [...markup.matchAll(OPENING_TAG)].map((tag) => {
    const attributes = new Map<string, string>();
    for (const attribute of (tag[2] ?? '').matchAll(ATTRIBUTE)) {
      const name = attribute[1];
      if (name !== undefined) {
        attributes.set(name, attribute[2] ?? '');
      }
    }
    return { name: tag[1] ?? '', attributes };
  });
}

const PLAIN_ELEMENTS = ['svg', 'g', 'rect', 'circle', 'path', 'text', 'image'];
const SPIKE_ELEMENTS = ['defs', 'linearGradient', 'stop', 'clipPath'];
const FORBIDDEN_ATTRIBUTES = ['style', 'class', 'opacity', 'filter', 'mask'];
const PAINT_ATTRIBUTES = ['fill', 'stroke', 'stop-color'];
const SPIKE_PAINTS = ['url(#hello-gradient)'];

function canvasColorValues(colors: CanvasColors): Set<string> {
  const { theme: _theme, issue: issues, ...core } = colors;
  const values = new Set<string>(Object.values(core));
  for (const value of Object.values(issues)) {
    values.add(value.fill);
    values.add(value.poster);
    values.add(value.on);
  }
  return values;
}

/**
 * Every way `markup` breaks the plain-canvas rules, one line each, prefixed by the rule it breaks:
 * `element:` (an element that is not plain, or no element at all), `attribute:` (a forbidden
 * attribute) and `paint:` (a color that is not a value of `colors`, or no paint at all). The spike
 * card (`spike`) is admitted its gradient, its clip path and their elements.
 */
export function plainCanvasProblems(
  markup: string,
  colors: CanvasColors,
  spike: boolean,
): string[] {
  const tags = scanTags(markup);
  const problems: string[] = [];

  const elements = new Set([...PLAIN_ELEMENTS, ...(spike ? SPIKE_ELEMENTS : [])]);
  if (tags.length === 0) {
    problems.push('element: the markup has no element');
  }
  for (const tag of tags) {
    if (!elements.has(tag.name)) {
      problems.push(`element: <${tag.name}>`);
    }
  }

  const forbidden = new Set([...FORBIDDEN_ATTRIBUTES, ...(spike ? [] : ['clip-path'])]);
  for (const tag of tags) {
    for (const name of tag.attributes.keys()) {
      if (forbidden.has(name)) {
        problems.push(`attribute: <${tag.name}> ${name}`);
      }
    }
  }

  const paints = new Set(['none', ...canvasColorValues(colors), ...(spike ? SPIKE_PAINTS : [])]);
  let painted = 0;
  for (const tag of tags) {
    for (const name of PAINT_ATTRIBUTES) {
      const value = tag.attributes.get(name);
      if (value === undefined) {
        continue;
      }
      painted += 1;
      if (!paints.has(value)) {
        problems.push(`paint: <${tag.name}> ${name}=${value}`);
      }
    }
  }
  if (painted === 0) {
    problems.push('paint: the markup paints nothing');
  }
  return problems;
}

/** The canvas colors of each theme. */
export const CARD_COLORS: Readonly<Record<CardTheme, CanvasColors>> = {
  light: canvasColorsFrom('light', color.light, issue),
  dark: canvasColorsFrom('dark', color.dark, issue),
};

const THEMES: readonly CardTheme[] = ['light', 'dark'];

/** TEST-i18n's pseudo-locale: every catalog value lengthened by 40% and bracketed. */
function pseudo(value: string): string {
  return '[' + value + '~'.repeat(Math.ceil(value.length * 0.4)) + ']';
}

/** An i18next post-processor module, which an instance's `use` takes. */
type PostProcessor = { type: 'postProcessor'; name: string; process: (value: string) => string };

const PSEUDO: PostProcessor = {
  type: 'postProcessor',
  name: 'pseudo',
  process: (value: string) => pseudo(value),
};

/** createI18n() in English, or with the pseudo-locale post-processor of TEST-i18n. Each call is a new instance. */
export async function cardT(locale: 'en' | 'pseudo'): Promise<TFunction> {
  const instance = await Promise.resolve(createI18n());
  if (locale === 'pseudo') {
    instance.use(PSEUDO);
    instance.options.postProcess = ['pseudo'];
  }
  // The typed t accepts catalog keys only; the builders pass each key as a plain string.
  return instance.getFixedT('en') as unknown as TFunction;
}

/**
 * Renders `render(colors)` in both themes; compares the markup exactly with `<name>.<theme>.svg`
 * and the PNG of `size` with `<name>.<theme>.png` within the tolerance (at most 1% of pixels differ
 * by more than 8 of 255 in any channel, D-100); returns the markup per theme.
 */
export async function expectCardGolden(
  name: string,
  render: (colors: CanvasColors) => ReactElement,
  size: { width: number; height: number },
): Promise<Readonly<Record<CardTheme, string>>> {
  const markup: Partial<Record<CardTheme, string>> = {};
  for (const theme of THEMES) {
    const colors = CARD_COLORS[theme];
    const svg = renderToStaticMarkup(render(colors));
    expect(svg, `${name}.${theme}.svg`).toBe(goldenText(`${name}.${theme}.svg`, svg));
    const png = await renderCardPng(render(colors), { ...size, fontDir: FONT_DIR });
    const golden = goldenBytes(`${name}.${theme}.png`, png);
    expect(await pixelDiffRatio(png, golden), `${name}.${theme}.png`).toBeLessThanOrEqual(0.01);
    markup[theme] = svg;
  }
  const { light, dark } = markup;
  if (light === undefined || dark === undefined) {
    throw new Error(`${name} was not rendered in both themes`);
  }
  return { light, dark };
}

/** Compares an alt text with `<name>.alt.en.txt` or `<name>.alt.pseudo.txt` (the text plus one line feed). */
export function expectAltGolden(name: string, locale: 'en' | 'pseudo', text: string): void {
  const file = `${name}.alt.${locale}.txt`;
  const actual = `${text}\n`;
  expect(actual, file).toBe(goldenText(file, actual));
}
