import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderAsync } from '@resvg/resvg-js';
import { FONT_CSS, FONT_FILES } from '@citizenrun/shared';
import type { FontFace } from '@citizenrun/shared';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// CARD-render-png (D-270): the one function that turns a canvas element into PNG bytes.

export type RenderOptions = { width: number; height: number; fontDir: string };

type FontFileName = (typeof FONT_FILES)[FontFace];

// CARD-fonts
const TTF_SHA256: Readonly<Record<FontFileName, string>> = {
  [FONT_FILES.regular]: '5f778c05b05d2fa4ea23b6e90813fb8696da464b96ae6c6a0ad1bb91b300c517',
  [FONT_FILES.medium]: '7947c5aaa66aed1d9a8fbabbbb4bd0989bdb88ddbca20f6a0ed7b6c64039ad5f',
  [FONT_FILES.bold]: 'd0bd7ff2c3ff28c95a4536c1f9e9b16ffe32b3a34750101c999ee0ed9ca721bf',
  [FONT_FILES.mono]: 'b44520d1438626dee18115faab0df6ab0ea75408fb227f135e25a7ee73677dda',
};

const FONT_FILE_NAMES: readonly FontFileName[] = Object.values(FONT_FILES);

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const JPEG_DATA_URI = 'data:image/jpeg;base64,';

/** Elements a canvas never contains: each could fetch, run or embed something resvg draws differently. */
const FORBIDDEN_ELEMENTS: ReadonlySet<string> = new Set([
  'use',
  'style',
  'filter',
  'mask',
  'foreignobject',
  'pattern',
  'script',
]);

/** The markup is not a canvas the renderer accepts. The message names the first offender. */
export class CardMarkupError extends Error {
  override name = 'CardMarkupError';
}

/** The rendered image does not have the requested size: the element's view box does not match the format. */
export class CardRenderSizeError extends Error {
  override name = 'CardRenderSizeError';
  readonly expected: { width: number; height: number };
  readonly actual: { width: number; height: number };

  constructor(
    expected: { width: number; height: number },
    actual: { width: number; height: number },
  ) {
    super(
      `rendered ${String(actual.width)}x${String(actual.height)}, expected ${String(expected.width)}x${String(expected.height)}`,
    );
    this.expected = expected;
    this.actual = actual;
  }
}

function ttfPath(fontDir: string, name: FontFileName): string {
  return join(fontDir, `${name}.ttf`);
}

/** Throws unless the four TTF files exist under fontDir with their committed SHA-256 sums. Called once at service start. */
export function assertFontFiles(fontDir: string): void {
  for (const name of FONT_FILE_NAMES) {
    const path = ttfPath(fontDir, name);
    if (!existsSync(path)) {
      throw new Error(`font file ${name}.ttf is missing from the font folder`);
    }
    const sum = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (sum !== TTF_SHA256[name]) {
      throw new Error(`font file ${name}.ttf does not match its SHA-256 sum`);
    }
  }
}

// React escapes `<`, `>` and `"` inside attribute values and text, so in its markup every `<` opens a
// tag, every `>` closes one, and every attribute value is double-quoted.
const TAG = /<([A-Za-z][\w:.-]*)([^>]*)>/g;
const ATTRIBUTE = /([^\s=/]+)(?:="([^"]*)")?/g;

function attributesOf(source: string): { name: string; value: string }[] {
  const attributes: { name: string; value: string }[] = [];
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1];
    if (name !== undefined) {
      attributes.push({ name, value: match[2] ?? '' });
    }
  }
  return attributes;
}

function isHref(attributeName: string): boolean {
  const name = attributeName.toLowerCase();
  return name === 'href' || name.endsWith(':href');
}

/** The element's local name in lower case: `svg:style` and `style` are the same element. */
function localName(element: string): string {
  return element.slice(element.lastIndexOf(':') + 1).toLowerCase();
}

/** Throws CardMarkupError at the first element the guards of CARD-render-png refuse. */
function assertSafeMarkup(markup: string): void {
  for (const tag of markup.matchAll(TAG)) {
    const element = tag[1] ?? '';
    const lowered = localName(element);
    if (FORBIDDEN_ELEMENTS.has(lowered)) {
      throw new CardMarkupError(`the element <${element}> is not allowed on a canvas`);
    }
    const hrefs = attributesOf(tag[2] ?? '').filter((attribute) => isHref(attribute.name));
    if (lowered === 'image') {
      if (hrefs.length === 0) {
        throw new CardMarkupError('the element <image> has no JPEG data URI');
      }
      for (const href of hrefs) {
        if (!href.value.startsWith(JPEG_DATA_URI)) {
          throw new CardMarkupError(
            `the element <image> has a ${href.name} that is not a JPEG data URI`,
          );
        }
      }
    } else if (hrefs[0] !== undefined) {
      throw new CardMarkupError(`the element <${element}> has a ${hrefs[0].name} attribute`);
    }
  }
}

/** Adds the SVG namespace to the root tag when it is missing: resvg refuses a root without it. */
function withNamespace(markup: string): string {
  const rootEnd = markup.indexOf('>');
  const rootTag = markup.slice(0, rootEnd);
  if (attributesOf(rootTag).some((attribute) => attribute.name === 'xmlns')) {
    return markup;
  }
  return `<svg xmlns="${SVG_NAMESPACE}"${markup.slice('<svg'.length)}`;
}

/** A React element whose root is the primitives' Svg, rendered to PNG bytes. Never fetches anything. */
export async function renderCardPng(
  element: ReactElement,
  options: RenderOptions,
): Promise<Uint8Array> {
  const rendered = renderToStaticMarkup(element);
  if (!/^<svg[\s/>]/.test(rendered)) {
    throw new CardMarkupError('the root element is not svg');
  }
  const markup = withNamespace(rendered);
  assertSafeMarkup(markup);

  const image = await renderAsync(markup, {
    fitTo: { mode: 'width', value: options.width },
    font: {
      loadSystemFonts: false,
      fontFiles: FONT_FILE_NAMES.map((name) => ttfPath(options.fontDir, name)),
      defaultFontFamily: FONT_CSS.regular.family,
    },
  });
  if (image.width !== options.width || image.height !== options.height) {
    throw new CardRenderSizeError(
      { width: options.width, height: options.height },
      { width: image.width, height: image.height },
    );
  }
  const png = image.asPng();
  return new Uint8Array(png.buffer, png.byteOffset, png.byteLength);
}
