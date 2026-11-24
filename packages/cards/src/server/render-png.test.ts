import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env } from 'node:process';
import { color, issue } from '@citizenrun/shared';
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { canvasColorsFrom } from '../colors.ts';
import type { CanvasColors } from '../colors.ts';
import { HelloCard } from '../templates/hello-card.tsx';
import {
  assertFontFiles,
  CardMarkupError,
  CardRenderSizeError,
  renderCardPng,
} from './render-png.ts';

const FONT_DIR = join(import.meta.dirname, '../../assets/fonts');
const GOLDEN_DIR = join(import.meta.dirname, '../__golden__');
const PHOTO_PATH = join(import.meta.dirname, '../__fixtures__/photo.jpg');

/** Golden files are rewritten only when the run sets UPDATE_GOLDEN=1; the difference is read before it is committed. */
const updateGolden = env.UPDATE_GOLDEN === '1';

/** The fixture photograph as the JPEG data URI the server embeds (D-273). */
function photoDataUri(): string {
  return `data:image/jpeg;base64,${readFileSync(PHOTO_PATH).toString('base64')}`;
}

const LIGHT: CanvasColors = canvasColorsFrom('light', color.light, issue);

function helloElement(width?: number): ReactElement {
  return createElement(HelloCard, {
    colors: LIGHT,
    photoHref: photoDataUri(),
    ...(width === undefined ? {} : { width }),
  });
}

function missingGolden(name: string): Error {
  return new Error(
    `Golden file ${name} is missing; run the test once with UPDATE_GOLDEN=1 and read the result before committing`,
  );
}

/** The golden text `name`: written from `actual` under UPDATE_GOLDEN=1, read otherwise. */
function goldenText(name: string, actual: string): string {
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
function goldenBytes(name: string, actual: Uint8Array): Uint8Array {
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
async function pixelDiffRatio(a: Uint8Array, b: Uint8Array): Promise<number> {
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

const FONT_FILES = [
  'SpecialGothic-Regular.ttf',
  'SpecialGothic-Medium.ttf',
  'SpecialGothic-Bold.ttf',
  'ChivoMono-Medium.ttf',
  'SpecialGothic-Regular.woff2',
  'SpecialGothic-Medium.woff2',
  'SpecialGothic-Bold.woff2',
  'ChivoMono-Medium.woff2',
];
const OPTIONS = { width: 540, height: 675, fontDir: FONT_DIR };
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A 1 by 1 red JPEG, made for this test. */
const JPEG_1X1 =
  '/9j/4AAQSkZJRgABAQAASABIAAD/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9sAQwATExMTExMgExMgLSAgIC09LS0tLT1NPT09PT1NXU1NTU1NTV1dXV1dXV1dcHBwcHBwg4ODg4OTk5OTk5OTk5OT/9sAQwEXGBglIyVAIyNAmWhVaJmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZ/90ABAAB/9oADAMBAAIRAxEAPwDJooorgPrD/9k=';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

function ihdrSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function card(children: ReactNode[], props: Record<string, unknown> = {}): ReactElement {
  return createElement(
    'svg',
    { width: 540, height: 675, viewBox: '0 0 1080 1350', ...props },
    createElement('rect', { x: 0, y: 0, width: 1080, height: 1350, fill: '#f4f1ea' }),
    ...children,
  );
}

function fixtureText(fontWeight: number, fontFamily = 'Special Gothic'): ReactElement {
  return createElement(
    'text',
    { key: 'text', x: 96, y: 400, fontFamily, fontWeight, fontSize: 160, fill: '#151515' },
    'Fixture',
  );
}

const temporaryDirs: string[] = [];

function fontDirCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cards-fonts-'));
  temporaryDirs.push(dir);
  cpSync(FONT_DIR, dir, { recursive: true });
  return dir;
}

afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('renderCardPng', () => {
  it('fonts are the committed files', () => {
    const lines = readFileSync(join(FONT_DIR, 'SHA256SUMS'), 'utf8').trim().split('\n');
    const present = new Set(readdirSync(FONT_DIR));
    const listed: string[] = [];
    for (const line of lines) {
      const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
      expect(match, line).not.toBeNull();
      const [, sum, name] = match ?? [];
      if (sum === undefined || name === undefined) {
        throw new Error(`unreadable line in SHA256SUMS: ${line}`);
      }
      expect(present.has(name), name).toBe(true);
      expect(sha256(readFileSync(join(FONT_DIR, name))), name).toBe(sum);
      listed.push(name);
    }
    expect([...listed].sort()).toEqual([...FONT_FILES].sort());

    expect(() => {
      assertFontFiles(FONT_DIR);
    }).not.toThrow();

    const changed = fontDirCopy();
    const medium = join(changed, 'SpecialGothic-Medium.ttf');
    const bytes = readFileSync(medium);
    bytes[bytes.length >> 1] = (bytes[bytes.length >> 1] ?? 0) ^ 0xff;
    writeFileSync(medium, bytes);
    expect(() => {
      assertFontFiles(changed);
    }).toThrow(/SpecialGothic-Medium\.ttf/);

    const missing = fontDirCopy();
    rmSync(join(missing, 'ChivoMono-Medium.ttf'));
    expect(() => {
      assertFontFiles(missing);
    }).toThrow(/ChivoMono-Medium\.ttf/);
  });

  it('renders an svg element to a PNG of the requested size', async () => {
    const png = await renderCardPng(card([fixtureText(500)]), OPTIONS);
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(ihdrSize(png)).toEqual({ width: 540, height: 675 });
  });

  it('adds the namespace resvg needs', async () => {
    const element = card([fixtureText(500)]);
    expect(element.props).not.toHaveProperty('xmlns');
    const withoutProp = await renderCardPng(element, OPTIONS);
    expect(ihdrSize(withoutProp)).toEqual({ width: 540, height: 675 });

    // A root that already names the namespace is not given a second xmlns attribute.
    const withProp = await renderCardPng(
      card([fixtureText(500)], { xmlns: 'http://www.w3.org/2000/svg' }),
      OPTIONS,
    );
    expect(sameBytes(withProp, withoutProp)).toBe(true);
  });

  it('draws the text with the committed faces', async () => {
    const medium = await renderCardPng(card([fixtureText(500)]), OPTIONS);
    const blank = await renderCardPng(card([]), OPTIONS);
    const bold = await renderCardPng(card([fixtureText(700)]), OPTIONS);
    const mono = await renderCardPng(card([fixtureText(500, 'Chivo Mono')]), OPTIONS);
    expect(sameBytes(medium, blank)).toBe(false);
    expect(sameBytes(medium, bold)).toBe(false);
    expect(sameBytes(medium, mono)).toBe(false);
  });

  it('never draws with a font of the machine', async () => {
    // With system fonts off, a family that is not a committed face falls back to the committed
    // faces, so each of these renders the same bytes. A machine that has any of these families
    // installed draws it differently once system fonts are loaded.
    const systemFamilies = [
      'Helvetica',
      'Times',
      'Courier',
      'Arial',
      'Times New Roman',
      'DejaVu Sans',
      'Liberation Serif',
      'serif',
      'monospace',
    ];
    const renders = await Promise.all(
      systemFamilies.map((family) => renderCardPng(card([fixtureText(400, family)]), OPTIONS)),
    );
    const blank = await renderCardPng(card([]), OPTIONS);
    const [first] = renders;
    if (first === undefined) {
      throw new Error('nothing was rendered');
    }
    expect(sameBytes(first, blank)).toBe(false);
    for (const [index, render] of renders.entries()) {
      expect(sameBytes(render, first), systemFamilies[index]).toBe(true);
    }
  });

  it('refuses a size that does not match the view box', async () => {
    await expect(
      renderCardPng(card([fixtureText(500)]), { ...OPTIONS, height: 700 }),
    ).rejects.toBeInstanceOf(CardRenderSizeError);
  });

  describe('no external fetch, no WebP', () => {
    const image = (href: string): ReactElement =>
      createElement('image', { key: 'image', x: 0, y: 0, width: 1080, height: 1350, href });
    const hostile: { label: string; child: ReactElement; names: RegExp }[] = [
      { label: 'an https image', child: image('https://example.test/a.jpg'), names: /<image>/ },
      { label: 'a WebP image', child: image('data:image/webp;base64,AAAA'), names: /<image>/ },
      { label: 'an SVG image', child: image('data:image/svg+xml;base64,AAAA'), names: /<image>/ },
      { label: 'use', child: createElement('use', { key: 'use' }), names: /<use>/ },
      { label: 'style', child: createElement('style', { key: 'style' }), names: /<style>/ },
      { label: 'filter', child: createElement('filter', { key: 'filter' }), names: /<filter>/ },
      { label: 'mask', child: createElement('mask', { key: 'mask' }), names: /<mask>/ },
      {
        label: 'foreignObject',
        child: createElement('foreignObject', { key: 'foreignObject' }),
        names: /<foreignObject>/,
      },
      { label: 'pattern', child: createElement('pattern', { key: 'pattern' }), names: /<pattern>/ },
      { label: 'script', child: createElement('script', { key: 'script' }), names: /<script>/ },
      {
        label: 'a link',
        child: createElement('a', { key: 'a', href: 'https://example.test/' }),
        names: /<a>/,
      },
    ];

    for (const { label, child, names } of hostile) {
      it(`refuses ${label}`, async () => {
        const rendering = renderCardPng(card([child]), OPTIONS);
        await expect(rendering).rejects.toBeInstanceOf(CardMarkupError);
        await expect(rendering).rejects.toThrow(names);
      });
    }

    it('refuses an image given through xlink:href', async () => {
      const child = createElement('image', {
        key: 'image',
        width: 10,
        height: 10,
        xlinkHref: 'https://example.test/a.jpg',
      });
      await expect(renderCardPng(card([child]), OPTIONS)).rejects.toThrow(/xlink:href/);
    });

    it('draws a JPEG data URI', async () => {
      const png = await renderCardPng(card([image(`data:image/jpeg;base64,${JPEG_1X1}`)]), OPTIONS);
      expect(ihdrSize(png)).toEqual({ width: 540, height: 675 });
      const blank = await renderCardPng(card([]), OPTIONS);
      expect(sameBytes(png, blank)).toBe(false);
    });
  });

  it('refuses a root that is not svg', async () => {
    const root = createElement(
      'g',
      null,
      createElement('rect', { width: 1080, height: 1350, fill: '#f4f1ea' }),
    );
    const rendering = renderCardPng(root, OPTIONS);
    await expect(rendering).rejects.toBeInstanceOf(CardMarkupError);
    await expect(rendering).rejects.toThrow('the root element is not svg');
  });
});

// React escapes `<`, `>` and `"` inside attribute values and text, so in its markup every `<` opens a
// tag and every attribute value is double-quoted.
const OPENING_TAG = /<([a-zA-Z]+)\b([^>]*)>/g;
const ATTRIBUTE = /([^\s=/]+)(?:="([^"]*)")?/g;

type ScannedTag = { name: string; attributes: Map<string, string> };

/** Every opening tag of `markup`, with its attributes. */
function scanTags(markup: string): ScannedTag[] {
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

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('hello card', () => {
  it('hello card markup matches its golden SVG', () => {
    const markup = renderToStaticMarkup(helloElement());
    expect(markup).toBe(goldenText('hello.light.svg', markup));
  });

  it('hello card matches its golden image', async () => {
    const png = await renderCardPng(helloElement(), { width: 540, height: 675, fontDir: FONT_DIR });
    expect(ihdrSize(png)).toEqual({ width: 540, height: 675 });
    const golden = goldenBytes('hello.light.png', png);
    expect(await pixelDiffRatio(png, golden)).toBeLessThanOrEqual(0.01);
  });

  it('hello card renders the same bytes twice', async () => {
    const options = { width: 540, height: 675, fontDir: FONT_DIR };
    const first = await renderCardPng(helloElement(), options);
    const second = await renderCardPng(helloElement(), options);
    expect(sameBytes(first, second)).toBe(true);
  });

  it('hello card uses the four faces and nothing else', () => {
    const markup = renderToStaticMarkup(helloElement());
    const faces = new Set(
      scanTags(markup)
        .filter((tag) => tag.name === 'text')
        .map(
          (tag) =>
            `${tag.attributes.get('font-family') ?? ''} ${tag.attributes.get('font-weight') ?? ''}`,
        ),
    );
    expect([...faces].sort()).toEqual([
      'Chivo Mono 500',
      'Special Gothic 400',
      'Special Gothic 500',
      'Special Gothic 700',
    ]);
    expect(markup).toContain('font-family="Special Gothic" font-weight="400"');
    expect(markup).toContain('font-family="Special Gothic" font-weight="500"');
    expect(markup).toContain('font-family="Special Gothic" font-weight="700"');
    expect(markup).toContain('font-family="Chivo Mono" font-weight="500"');
    for (const forbidden of ['Inter', 'font-feature-settings', 'font-variant', 'tnum']) {
      expect(markup, forbidden).not.toContain(forbidden);
    }
  });

  it('hello card holds no sentinel color', () => {
    const markup = renderToStaticMarkup(helloElement()).toUpperCase();
    for (const sentinel of ['#111111', '#FFFFFF', '#7A7A7A', '#D93A1E']) {
      expect(markup, sentinel).not.toContain(sentinel);
    }
  });

  it('hello card tracks and tilts', () => {
    const markup = renderToStaticMarkup(helloElement());
    expect(markup).toContain('letter-spacing="1.6"');
    expect(markup).toContain('letter-spacing="-1.4"');
    expect(markup).toContain('letter-spacing="-9.9"');
    expect(countOf(markup, 'transform="rotate(-3 236 726)"')).toBe(1);
  });
});

describe('plain canvas markup', () => {
  type CardFixture = {
    name: string;
    element: ReactElement;
    colors: CanvasColors;
    /** The spike card: the four spike elements, `clip-path` and its gradient fill are admitted. */
    spike: boolean;
  };

  const CARD_FIXTURES: CardFixture[] = [
    { name: 'hello', element: helloElement(), colors: LIGHT, spike: true },
  ];

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

  for (const fixture of CARD_FIXTURES) {
    it(`the ${fixture.name} fixture uses only the plain canvas elements`, () => {
      const allowed = new Set([...PLAIN_ELEMENTS, ...(fixture.spike ? SPIKE_ELEMENTS : [])]);
      const tags = scanTags(renderToStaticMarkup(fixture.element));
      expect(tags.length).toBeGreaterThan(0);
      const offenders = tags.map((tag) => tag.name).filter((name) => !allowed.has(name));
      expect(offenders).toEqual([]);
    });

    it(`the ${fixture.name} fixture carries no forbidden attribute`, () => {
      const forbidden = new Set([...FORBIDDEN_ATTRIBUTES, ...(fixture.spike ? [] : ['clip-path'])]);
      const offenders = scanTags(renderToStaticMarkup(fixture.element)).flatMap((tag) =>
        [...tag.attributes.keys()]
          .filter((name) => forbidden.has(name))
          .map((name) => `<${tag.name}> ${name}`),
      );
      expect(offenders).toEqual([]);
    });

    it(`the ${fixture.name} fixture paints only with its canvas colors`, () => {
      const allowed = new Set([
        'none',
        ...canvasColorValues(fixture.colors),
        ...(fixture.spike ? SPIKE_PAINTS : []),
      ]);
      const paints = scanTags(renderToStaticMarkup(fixture.element)).flatMap((tag) =>
        PAINT_ATTRIBUTES.filter((name) => tag.attributes.has(name)).map(
          (name) => `<${tag.name}> ${name}=${tag.attributes.get(name) ?? ''}`,
        ),
      );
      expect(paints.length).toBeGreaterThan(0);
      const offenders = paints.filter((paint) => !allowed.has(paint.slice(paint.indexOf('=') + 1)));
      expect(offenders).toEqual([]);
    });
  }
});

describe('renderer guards', () => {
  const GUARD_OPTIONS = { width: 10, height: 10, fontDir: FONT_DIR };

  function root(child: ReactElement): ReactElement {
    return createElement('svg', { width: 10, height: 10, viewBox: '0 0 10 10' }, child);
  }

  function image(href: string): ReactElement {
    return createElement('image', { key: 'image', x: 0, y: 0, width: 10, height: 10, href });
  }

  const hostile: { label: string; child: ReactElement; names: RegExp }[] = [
    {
      label: 'an image from an https URL',
      child: image('https://media.example.test/a.jpg'),
      names: /<image>/,
    },
    {
      label: 'a WebP data URI image',
      child: image('data:image/webp;base64,AAAA'),
      names: /<image>/,
    },
    { label: 'a PNG data URI image', child: image('data:image/png;base64,AAAA'), names: /<image>/ },
    { label: 'use', child: createElement('use', { key: 'use' }), names: /<use>/ },
    { label: 'style', child: createElement('style', { key: 'style' }), names: /<style>/ },
    { label: 'filter', child: createElement('filter', { key: 'filter' }), names: /<filter>/ },
    { label: 'mask', child: createElement('mask', { key: 'mask' }), names: /<mask>/ },
    {
      label: 'foreignObject',
      child: createElement('foreignObject', { key: 'foreignObject' }),
      names: /<foreignObject>/,
    },
    { label: 'pattern', child: createElement('pattern', { key: 'pattern' }), names: /<pattern>/ },
    { label: 'script', child: createElement('script', { key: 'script' }), names: /<script>/ },
    {
      label: 'a link with an href',
      child: createElement('a', { key: 'a', href: 'https://media.example.test/' }),
      names: /<a> has a href/,
    },
    {
      label: 'a rect with an xlink:href',
      child: createElement('rect', {
        key: 'rect',
        width: 10,
        height: 10,
        fill: '#000000',
        xlinkHref: 'https://media.example.test/a.jpg',
      }),
      names: /<rect> has a xlink:href/,
    },
  ];

  for (const { label, child, names } of hostile) {
    it(`refuses ${label} and names it`, async () => {
      const rendering = renderCardPng(root(child), GUARD_OPTIONS);
      await expect(rendering).rejects.toBeInstanceOf(CardMarkupError);
      await expect(rendering).rejects.toThrow(names);
    });
  }

  it('renders a rect and an image whose href is a JPEG data URI', async () => {
    const jpeg = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#000000' },
    })
      .jpeg()
      .toBuffer();
    const element = createElement(
      'svg',
      { width: 10, height: 10, viewBox: '0 0 10 10' },
      createElement('rect', { key: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#ffffff' }),
      image(`data:image/jpeg;base64,${jpeg.toString('base64')}`),
    );
    const png = await renderCardPng(element, GUARD_OPTIONS);
    expect([...png.subarray(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(ihdrSize(png)).toEqual({ width: 10, height: 10 });
  });
});
