import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertFontFiles,
  CardMarkupError,
  CardRenderSizeError,
  renderCardPng,
} from './render-png.ts';

const FONT_DIR = fileURLToPath(new URL('../../assets/fonts', import.meta.url));
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
