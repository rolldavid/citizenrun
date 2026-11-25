import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FONT_FILES } from '@citizenrun/shared';
import { webExportProblems } from './assert-web-export.ts';

const SHELL_CSS_FIXTURE =
  '@font-face{font-family:"Fixture"}\n:focus:not(:focus-visible){outline:none}';

const PRELOADS = [
  '<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/2/SpecialGothic-Medium.woff2" />',
  '<link\n      rel="preload"\n      as="font"\n      type="font/woff2"\n      crossorigin\n      href="/fonts/2/SpecialGothic-Bold.woff2"\n    />',
];

function shellHtml(options?: {
  head?: string;
  body?: string;
  css?: string;
  preloads?: readonly string[];
}): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="utf-8" />',
    ...(options?.preloads ?? PRELOADS).map((link) => `    ${link}`),
    '    <!-- prettier-ignore -->',
    `    <style id="os-shell">${options?.css ?? SHELL_CSS_FIXTURE}</style>`,
    `    ${options?.head ?? '<!--os:head-->'}`,
    '  <link rel="icon" href="/favicon.ico"/></head>',
    '  <body>',
    `    ${options?.body ?? '<!--os:body-->'}`,
    '    <div id="root"></div>',
    '  <script src="/_expo/static/js/web/index-0123.js" defer></script>',
    '</body>',
    '</html>',
  ].join('\n');
}

/** The bytes of one fixture font: the face name, so each file differs from the others. */
function fontBytes(face: string): Buffer {
  return Buffer.from(`fixture font ${face}`);
}

let root: string;
let distDir: string;
let fontsDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'assert-web-export-'));
  distDir = join(root, 'dist');
  fontsDir = join(root, 'fonts');
  mkdirSync(join(distDir, '_expo/static/js/web'), { recursive: true });
  mkdirSync(join(distDir, 'fonts/2'), { recursive: true });
  mkdirSync(fontsDir);
  writeFileSync(join(distDir, 'index.html'), shellHtml());
  writeFileSync(join(distDir, '_expo/static/js/web/index-0123.js'), 'console.log(1);');
  writeFileSync(join(distDir, 'metadata.json'), '{}');
  for (const face of Object.values(FONT_FILES)) {
    writeFileSync(join(fontsDir, `${face}.woff2`), fontBytes(face));
    writeFileSync(join(distDir, 'fonts/2', `${face}.woff2`), fontBytes(face));
  }
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function problems(): string[] {
  return webExportProblems(distDir, fontsDir, SHELL_CSS_FIXTURE);
}

describe('webExportProblems', () => {
  it('a complete export has no problem', () => {
    expect(problems()).toEqual([]);
  });

  it('reports a missing index.html', () => {
    rmSync(join(distDir, 'index.html'));
    expect(problems()).toEqual(['dist/index.html does not exist']);
  });

  it('reports a dist/server folder', () => {
    mkdirSync(join(distDir, 'server'));
    expect(problems()).toEqual(['dist/server exists; the web output must be single (D-031)']);
  });

  it('reports a second .html file', () => {
    mkdirSync(join(distDir, 'office'));
    writeFileSync(join(distDir, 'office/index.html'), '<!doctype html>');
    expect(problems()).toEqual([
      'dist/office/index.html is an HTML file; index.html must be the only one',
    ]);
  });

  it('reports an export with no .js chunk', () => {
    rmSync(join(distDir, '_expo/static/js/web/index-0123.js'));
    writeFileSync(join(distDir, '_expo/static/js/web/index-0123.js.map'), '{}');
    expect(problems()).toEqual(['dist/_expo/static/js/web/ holds no .js file']);
  });

  it('reports a marker that appears twice', () => {
    writeFileSync(join(distDir, 'index.html'), shellHtml({ head: '<!--os:head--><!--os:head-->' }));
    expect(problems()).toEqual([
      'index.html holds the marker <!--os:head--> 2 times, expected once',
    ]);
  });

  it('reports a missing marker', () => {
    writeFileSync(join(distDir, 'index.html'), shellHtml({ body: '' }));
    expect(problems()).toEqual([
      'index.html holds the marker <!--os:body--> 0 times, expected once',
    ]);
  });

  it('reports a style text that differs by one character', () => {
    const changed = SHELL_CSS_FIXTURE.replace('Fixture', 'Fixturf');
    writeFileSync(join(distDir, 'index.html'), shellHtml({ css: changed }));
    const at = SHELL_CSS_FIXTURE.indexOf('Fixture') + 'Fixtur'.length;
    expect(problems()).toEqual([
      `index.html: the text of <style id="os-shell"> differs from SHELL_CSS at character ${String(at)}`,
    ]);
  });

  it('reports a style text with a trailing newline added', () => {
    writeFileSync(join(distDir, 'index.html'), shellHtml({ css: `${SHELL_CSS_FIXTURE}\n` }));
    expect(problems()).toEqual([
      `index.html: the text of <style id="os-shell"> differs from SHELL_CSS at character ${String(SHELL_CSS_FIXTURE.length)}`,
    ]);
  });

  it('reports a missing shell style element', () => {
    const html = shellHtml().replace(/<style id="os-shell">[\s\S]*?<\/style>/, '');
    writeFileSync(join(distDir, 'index.html'), html);
    expect(problems()).toEqual(['index.html holds 0 <style id="os-shell"> elements, expected one']);
  });

  it('reports a missing preload link', () => {
    writeFileSync(join(distDir, 'index.html'), shellHtml({ preloads: [PRELOADS[0] ?? ''] }));
    expect(problems()).toEqual([
      'index.html has no font preload link for /fonts/2/SpecialGothic-Bold.woff2',
    ]);
  });

  it('reports a preload link without crossorigin', () => {
    const withoutCors = (PRELOADS[0] ?? '').replace(' crossorigin', '');
    writeFileSync(
      join(distDir, 'index.html'),
      shellHtml({ preloads: [withoutCors, PRELOADS[1] ?? ''] }),
    );
    expect(problems()).toEqual([
      'index.html has no font preload link for /fonts/2/SpecialGothic-Medium.woff2',
    ]);
  });

  it('reports a WOFF2 file that differs by one byte', () => {
    const bytes = fontBytes(FONT_FILES.mono);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    writeFileSync(join(distDir, 'fonts/2', `${FONT_FILES.mono}.woff2`), bytes);
    expect(problems()).toEqual([
      'dist/fonts/2/ChivoMono-Medium.woff2 differs from the committed file',
    ]);
  });

  it('reports a WOFF2 file missing from the export', () => {
    rmSync(join(distDir, 'fonts/2', `${FONT_FILES.regular}.woff2`));
    expect(problems()).toEqual(['dist/fonts/2/SpecialGothic-Regular.woff2 is missing']);
  });
});
