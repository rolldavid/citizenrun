import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FONT_FILES, FONT_URL_BASE, SHELL_CSS } from '@citizenrun/shared';
import { repoRoot } from './lib/repo-root.ts';

/** The two markers the API replaces on every response (D-165). */
export const SHELL_MARKERS: readonly string[] = ['<!--os:head-->', '<!--os:body-->'];

/** The faces the shell preloads: Medium and Bold. */
const PRELOADED_FACES = [FONT_FILES.medium, FONT_FILES.bold] as const;

const STYLE_OPEN = /<style\b([^>]*)>/gi;
const LINK_TAG = /<link\b([^>]*)>/gi;
const ATTRIBUTE = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** The attributes of one tag, names in lower case; an attribute with no value maps to ''. */
function attributesOf(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1];
    if (name === undefined) {
      continue;
    }
    attributes.set(name.toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/** Every file under `dir`, as paths relative to it with `/` separators. */
function filesUnder(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else {
        files.push(relative(dir, path).split(sep).join('/'));
      }
    }
  };
  walk(dir);
  return files.sort();
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** The index of the first character where two strings differ, or -1 when they are equal. */
function firstDifference(a: string, b: string): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) {
      return index;
    }
  }
  return -1;
}

function shellStyleProblems(html: string, shellCss: string): string[] {
  const openings = [...html.matchAll(STYLE_OPEN)].filter(
    (match) => attributesOf(match[1] ?? '').get('id') === 'os-shell',
  );
  if (openings.length !== 1) {
    return [
      `index.html holds ${String(openings.length)} <style id="os-shell"> elements, expected one`,
    ];
  }
  const opening = openings[0];
  if (opening === undefined) {
    return [];
  }
  const start = opening.index + opening[0].length;
  const end = html.indexOf('</style>', start);
  if (end === -1) {
    return ['index.html: <style id="os-shell"> is not closed'];
  }
  const text = html.slice(start, end);
  const at = firstDifference(text, shellCss);
  return at === -1
    ? []
    : [
        `index.html: the text of <style id="os-shell"> differs from SHELL_CSS at character ${String(at)}`,
      ];
}

function isFontPreload(attributes: Map<string, string>, href: string): boolean {
  return (
    attributes.get('rel') === 'preload' &&
    attributes.get('as') === 'font' &&
    attributes.get('type') === 'font/woff2' &&
    attributes.has('crossorigin') &&
    attributes.get('href') === href
  );
}

function preloadProblems(html: string): string[] {
  const links = [...html.matchAll(LINK_TAG)].map((match) => attributesOf(match[1] ?? ''));
  const problems: string[] = [];
  for (const face of PRELOADED_FACES) {
    const href = `${FONT_URL_BASE}/${face}.woff2`;
    if (!links.some((attributes) => isFontPreload(attributes, href))) {
      problems.push(`index.html has no font preload link for ${href}`);
    }
  }
  return problems;
}

function fontProblems(distDir: string, fontsDir: string): string[] {
  const problems: string[] = [];
  const servedDir = FONT_URL_BASE.replace(/^\//, '');
  for (const face of Object.values(FONT_FILES)) {
    const name = `${face}.woff2`;
    const committed = join(fontsDir, name);
    const exported = join(distDir, servedDir, name);
    if (!existsSync(committed)) {
      problems.push(`the committed font ${name} is missing`);
    } else if (!existsSync(exported)) {
      problems.push(`dist/${servedDir}/${name} is missing`);
    } else if (!readFileSync(exported).equals(readFileSync(committed))) {
      problems.push(`dist/${servedDir}/${name} differs from the committed file`);
    }
  }
  return problems;
}

/**
 * One line per failed rule of the web export assertion (D-031, D-165, D-526, D-527): the single
 * output shape, the two shell markers, the shell's style element, the two font preload links and
 * the four fonts copied byte for byte. An empty list means the export passes.
 */
export function webExportProblems(distDir: string, fontsDir: string, shellCss: string): string[] {
  if (!existsSync(distDir)) {
    return ['dist/ does not exist; run pnpm build:web'];
  }
  const problems: string[] = [];
  const indexPath = join(distDir, 'index.html');
  const hasIndex = existsSync(indexPath);
  if (!hasIndex) {
    problems.push('dist/index.html does not exist');
  }
  if (existsSync(join(distDir, 'server'))) {
    problems.push('dist/server exists; the web output must be single (D-031)');
  }
  const files = filesUnder(distDir);
  for (const file of files) {
    if (file.endsWith('.html') && file !== 'index.html') {
      problems.push(`dist/${file} is an HTML file; index.html must be the only one`);
    }
  }
  if (!files.some((file) => /^_expo\/static\/js\/web\/[^/]+\.js$/.test(file))) {
    problems.push('dist/_expo/static/js/web/ holds no .js file');
  }
  if (hasIndex) {
    const html = readFileSync(indexPath, 'utf8');
    for (const marker of SHELL_MARKERS) {
      const count = countOf(html, marker);
      if (count !== 1) {
        problems.push(
          `index.html holds the marker ${marker} ${String(count)} times, expected once`,
        );
      }
    }
    problems.push(...shellStyleProblems(html, shellCss), ...preloadProblems(html));
  }
  problems.push(...fontProblems(distDir, fontsDir));
  return problems;
}

/** Asserts the export in `apps/mobile/dist` and exits 1 when any rule fails. */
export function main(): number {
  const root = repoRoot();
  const problems = webExportProblems(
    join(root, 'apps/mobile/dist'),
    join(root, 'packages/cards/assets/fonts'),
    SHELL_CSS,
  );
  for (const problem of problems) {
    console.error(problem);
  }
  return problems.length === 0 ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
