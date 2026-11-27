import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { color, issue } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_CTX,
  NO_PHOTO_OPTIONS,
  OFFICE_HERO_FIXTURES,
  RUN_AGAINST_FIXTURES,
} from '../__fixtures__/office.fixtures.ts';
import { canvasColorsFrom } from '../colors.ts';
import type { CanvasColors } from '../colors.ts';
import { measureText, setStrictGlyphs } from '../layout-text.ts';
import { buildOfficeHeroModel } from '../model/office-hero.ts';
import { altText, buildRunAgainstModel } from '../model/run-against.ts';
import { fontAttrs, Text } from '../primitives/dom.ts';
import { CardCanvas } from '../templates/card-canvas.tsx';
import { HelloCard } from '../templates/hello-card.tsx';
import { OfficeHeroCanvas } from '../templates/office-hero.tsx';
import {
  assertFontFiles,
  CardMarkupError,
  CardRenderSizeError,
  renderCardPng,
} from './render-png.ts';
import {
  cardT,
  FONT_DIR,
  goldenBytes,
  goldenText,
  pixelDiffRatio,
  plainCanvasProblems,
  scanTags,
} from './testing/golden.ts';

const PHOTO_PATH = join(import.meta.dirname, '../__fixtures__/photo.jpg');

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

/** The column after the last one that holds ink: a pixel much darker than the paper. */
async function inkRight(png: Uint8Array): Promise<number> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let x = info.width - 1; x >= 0; x -= 1) {
    for (let y = 0; y < info.height; y += 1) {
      if ((data[(y * info.width + x) * info.channels] ?? 255) < 128) {
        return x + 1;
      }
    }
  }
  return 0;
}

/** The overlap flag of a simple glyph's first point and of a composite's component (OpenType `glyf`). */
const OVERLAP_SIMPLE = 0x40;
const OVERLAP_COMPOUND = 0x0400;

/**
 * The indices of the glyphs of a TrueType file that carry the overlap flag. Read from
 * the `head`, `maxp`, `loca` and `glyf` tables (D-846: no canvas face carries the flag).
 */
function glyphsWithOverlapFlag(font: Buffer): number[] {
  const tables = new Map<string, { offset: number; length: number }>();
  const tableCount = font.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    tables.set(font.toString('latin1', record, record + 4), {
      offset: font.readUInt32BE(record + 8),
      length: font.readUInt32BE(record + 12),
    });
  }
  const table = (tag: string): { offset: number; length: number } => {
    const found = tables.get(tag);
    if (found === undefined) {
      throw new Error(`the font has no ${tag} table`);
    }
    return found;
  };
  const longOffsets = font.readInt16BE(table('head').offset + 50) === 1;
  const glyphCount = font.readUInt16BE(table('maxp').offset + 4);
  const loca = table('loca').offset;
  const glyf = table('glyf').offset;
  const glyphStart = (index: number): number =>
    longOffsets ? font.readUInt32BE(loca + index * 4) : font.readUInt16BE(loca + index * 2) * 2;
  const flagged: number[] = [];
  for (let index = 0; index < glyphCount; index += 1) {
    const start = glyphStart(index);
    if (glyphStart(index + 1) === start) {
      continue;
    }
    const at = glyf + start;
    const contours = font.readInt16BE(at);
    if (contours > 0) {
      const instructionLength = font.readUInt16BE(at + 10 + contours * 2);
      const firstFlag = font.readUInt8(at + 12 + contours * 2 + instructionLength);
      if ((firstFlag & OVERLAP_SIMPLE) !== 0) {
        flagged.push(index);
      }
      continue;
    }
    let component = at + 10;
    for (;;) {
      const flags = font.readUInt16BE(component);
      if ((flags & OVERLAP_COMPOUND) !== 0) {
        flagged.push(index);
        break;
      }
      component += 4 + ((flags & 0x0001) !== 0 ? 4 : 2);
      component +=
        (flags & 0x0008) !== 0 ? 2 : (flags & 0x0040) !== 0 ? 4 : (flags & 0x0080) !== 0 ? 8 : 0;
      if ((flags & 0x0020) === 0) {
        break;
      }
    }
  }
  return flagged;
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

  it('no glyph of a canvas face carries the overlap flag', () => {
    const ttfFiles = FONT_FILES.filter((name) => name.endsWith('.ttf'));
    expect(ttfFiles).toHaveLength(4);
    for (const name of ttfFiles) {
      expect(glyphsWithOverlapFlag(readFileSync(join(FONT_DIR, name))), name).toEqual([]);
    }
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

  it('draws a line of the primitive without pair kerning, as wide as its advances', async () => {
    const line = {
      key: 'line',
      x: 66,
      y: 400,
      ...fontAttrs('medium'),
      fontSize: 92,
      fill: '#151515',
      children: 'Treasurer',
    };
    const unkerned = await inkRight(
      await renderCardPng(card([createElement(Text, line)]), OPTIONS),
    );
    const kerned = await inkRight(
      await renderCardPng(card([createElement('text', line)]), OPTIONS),
    );
    // The canvas is drawn at half size. The font kerns "Tr" and other pairs of this word by 14 units in all.
    const measured = (line.x + measureText(line.children, { face: 'medium', size: 92 })) / 2;
    expect(Math.abs(unkerned - measured)).toBeLessThanOrEqual(2);
    expect(unkerned - kerned).toBeGreaterThanOrEqual(5);
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
    expect(markup).not.toContain('letter-spacing');
    expect(countOf(markup, 'transform="rotate(-3 236 726)"')).toBe(1);
  });
});

describe('plain canvas markup', () => {
  type CardFixture = {
    name: string;
    /** The fixture's markup, drawn once the glyph check is on and the catalog is loaded. */
    markup: () => string;
    colors: CanvasColors;
    /** The spike card: the four spike elements, `clip-path` and its gradient fill are admitted. */
    spike: boolean;
  };

  let tEn: TFunction | undefined;

  beforeAll(async () => {
    setStrictGlyphs(true);
    tEn = await cardT('en');
  });

  function english(): TFunction {
    if (tEn === undefined) {
      throw new Error('the catalog is not loaded');
    }
    return tEn;
  }

  /** The run-against canvas of a fixture, drawn as its golden test draws it. */
  function runAgainstMarkup(name: keyof typeof RUN_AGAINST_FIXTURES): string {
    const data = RUN_AGAINST_FIXTURES[name];
    const t = english();
    const page = {
      key: data.office.id,
      officeId: data.office.id,
      template: 'run_against' as const,
      model: buildRunAgainstModel(data, t, FIXTURE_CTX, NO_PHOTO_OPTIONS),
      alt: altText(data, t, FIXTURE_CTX),
    };
    return renderToStaticMarkup(createElement(CardCanvas, { page, colors: LIGHT, width: 540 }));
  }

  /** The office hero of a fixture, drawn as its golden test draws it. */
  function heroMarkup(name: keyof typeof OFFICE_HERO_FIXTURES): string {
    const model = buildOfficeHeroModel(
      OFFICE_HERO_FIXTURES[name],
      english(),
      FIXTURE_CTX,
      NO_PHOTO_OPTIONS,
    );
    return renderToStaticMarkup(
      createElement(OfficeHeroCanvas, { model, colors: LIGHT, width: 540 }),
    );
  }

  const CARD_FIXTURES: CardFixture[] = [
    {
      name: 'hello',
      markup: () => renderToStaticMarkup(helloElement()),
      colors: LIGHT,
      spike: true,
    },
    ...(Object.keys(RUN_AGAINST_FIXTURES) as (keyof typeof RUN_AGAINST_FIXTURES)[]).map(
      (name): CardFixture => ({
        name: `run-against ${name}`,
        markup: () => runAgainstMarkup(name),
        colors: LIGHT,
        spike: false,
      }),
    ),
    ...(Object.keys(OFFICE_HERO_FIXTURES) as (keyof typeof OFFICE_HERO_FIXTURES)[]).map(
      (name): CardFixture => ({
        name: `office-hero ${name}`,
        markup: () => heroMarkup(name),
        colors: LIGHT,
        spike: false,
      }),
    ),
  ];

  /** The problems of one rule of the plain-canvas scan. */
  function problemsOf(fixture: CardFixture, rule: 'element' | 'attribute' | 'paint'): string[] {
    return plainCanvasProblems(fixture.markup(), fixture.colors, fixture.spike).filter((problem) =>
      problem.startsWith(`${rule}: `),
    );
  }

  it('covers the hello card and the seven office fixtures', () => {
    expect(CARD_FIXTURES.map((fixture) => fixture.name)).toEqual([
      'hello',
      'run-against known',
      'run-against allUnknown',
      'run-against lowConfidence',
      'run-against longTitle',
      'run-against titleNotDrawable',
      'office-hero twoLineTitle',
      'office-hero growsWithHolder',
    ]);
  });

  for (const fixture of CARD_FIXTURES) {
    it(`the ${fixture.name} fixture uses only the plain canvas elements`, () => {
      expect(problemsOf(fixture, 'element')).toEqual([]);
    });

    it(`the ${fixture.name} fixture carries no forbidden attribute`, () => {
      expect(problemsOf(fixture, 'attribute')).toEqual([]);
    });

    it(`the ${fixture.name} fixture paints only with its canvas colors`, () => {
      expect(problemsOf(fixture, 'paint')).toEqual([]);
    });

    it(`the ${fixture.name} fixture writes every line of text without pair kerning`, () => {
      const lines = scanTags(fixture.markup()).filter((tag) => tag.name === 'text');
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.map((line) => line.attributes.get('kerning'))).toEqual(lines.map(() => '0'));
    });
  }

  it('the scan names each break of the rules', () => {
    const markup =
      '<svg viewBox="0 0 10 10"><defs></defs><rect style="x" clip-path="url(#a)" fill="#123456"></rect></svg>';
    expect(plainCanvasProblems(markup, LIGHT, false)).toEqual([
      'element: <defs>',
      'attribute: <rect> style',
      'attribute: <rect> clip-path',
      'paint: <rect> fill=#123456',
    ]);
    expect(plainCanvasProblems('', LIGHT, false)).toEqual([
      'element: the markup has no element',
      'paint: the markup paints nothing',
    ]);
  });
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
    {
      label: 'a namespace-prefixed style',
      child: createElement('svg:style', { key: 'svg:style' }),
      names: /<svg:style>/,
    },
    {
      label: 'a namespace-prefixed filter',
      child: createElement('svg:filter', { key: 'svg:filter' }),
      names: /<svg:filter>/,
    },
    {
      label: 'a namespace-prefixed foreignObject',
      child: createElement('svg:foreignObject', { key: 'svg:foreignObject' }),
      names: /<svg:foreignObject>/,
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
