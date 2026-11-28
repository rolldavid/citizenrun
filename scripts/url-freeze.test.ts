import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { routeClassOf } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './lib/repo-root.ts';

// TEST-url-freeze: the public URL shapes and the app's link prefixes of D-166 are frozen. Changing
// either needs a decision (D-166).

/** The public URL shapes: a page that must keep its address. */
export const FROZEN_PUBLIC_SHAPES = ['/office/:slug', '/c/:slug', '/u/:handle', '/p/:id'] as const;
/** The paths the app claims as links into it. */
export const APP_LINK_PREFIXES = [
  '/',
  '/explore',
  '/office/*',
  '/c/*',
  '/u/*',
  '/p/*',
  '/messages/*',
  '/settings/*',
  '/activity',
] as const;

/** The shapes the app builds now; the other two arrive with their screens. */
const BUILT_SHAPES: readonly string[] = ['/office/:slug', '/c/:slug'];
/** The first segments whose routes must keep a frozen shape. */
const FROZEN_FIRST_SEGMENTS: ReadonlySet<string> = new Set(['office', 'c', 'u', 'p']);
/** The folders whose route files must hold their frozen shape. */
const SHAPED_FOLDERS: readonly string[] = ['u/', 'p/'];
const ROUTE_FILE = /\.(tsx|ts|jsx|js)$/;
const APP_DIR = 'apps/mobile/app';

/** The URL shape of a route file under apps/mobile/app: groups dropped, [x] as :x, a trailing /index dropped. */
export function routeShape(file: string): string | null {
  const path = file.replace(ROUTE_FILE, '');
  const segments = path.split('/');
  const last = segments[segments.length - 1] ?? '';
  if (last === '_layout' || last.startsWith('+') || segments[0] === 'dev') {
    return null;
  }
  const kept = segments
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .map((segment) =>
      segment.startsWith('[') && segment.endsWith(']') ? `:${segment.slice(1, -1)}` : segment,
    );
  if (kept[kept.length - 1] === 'index') {
    kept.pop();
  }
  return `/${kept.join('/')}`;
}

/** Whether a prefix covers a path: the path itself, or for `/<x>/*` a path under `/<x>/`. */
function covers(prefix: string, path: string): boolean {
  return prefix.endsWith('/*') ? path.startsWith(prefix.slice(0, -1)) : prefix === path;
}

/** A shape with each parameter replaced by `x`, as a real address of it. */
function sampleOf(shape: string): string {
  return shape
    .split('/')
    .map((segment) => (segment.startsWith(':') ? 'x' : segment))
    .join('/');
}

/** Every rule below, as problems; [] when the tree passes. */
export function urlFreezeProblems(routeFiles: readonly string[]): string[] {
  const problems: string[] = [];
  const frozen: readonly string[] = FROZEN_PUBLIC_SHAPES;
  const routes = routeFiles.flatMap((file) => {
    const shape = routeShape(file);
    return shape === null ? [] : [{ file, shape }];
  });
  const shapes = new Set(routes.map((route) => route.shape));

  // (a) The shapes the app builds are routes.
  for (const shape of BUILT_SHAPES) {
    if (!shapes.has(shape)) {
      problems.push(`(a) ${shape} is the shape of no route file`);
    }
  }
  // (b) A route under a frozen first segment is a frozen shape or extends one.
  for (const { file, shape } of routes) {
    const first = shape.split('/')[1] ?? '';
    if (
      FROZEN_FIRST_SEGMENTS.has(first) &&
      !frozen.some((frozenShape) => shape === frozenShape || shape.startsWith(`${frozenShape}/`))
    ) {
      problems.push(`(b) ${file} has the shape ${shape}, which is no frozen shape nor under one`);
    }
  }
  // (c) A folder of a shape not built yet holds that shape once it holds any route.
  for (const folder of SHAPED_FOLDERS) {
    const own = frozen.find((shape) => shape.startsWith(`/${folder}`));
    if (
      own !== undefined &&
      routes.some(({ file }) => file.startsWith(folder)) &&
      !shapes.has(own)
    ) {
      problems.push(`(c) app/${folder} holds a route but not ${own}`);
    }
  }
  for (const shape of frozen) {
    // (d) The app claims the shape's links.
    if (!APP_LINK_PREFIXES.some((prefix) => covers(prefix, shape))) {
      problems.push(`(d) ${shape} is covered by no app link prefix`);
    }
    // (e) The server serves the page without a session.
    const routeClass = routeClassOf(sampleOf(shape));
    if (routeClass !== 'public') {
      problems.push(`(e) ${shape} is of class ${routeClass}, not public`);
    }
  }
  return problems;
}

/** Every file under apps/mobile/app, relative to it, with `/` between segments. */
function appRouteFiles(): string[] {
  return readdirSync(join(repoRoot(), APP_DIR), { recursive: true, encoding: 'utf8' })
    .map((path) => path.split('\\').join('/'))
    .filter((path) => ROUTE_FILE.test(path) && !/\.test\.[jt]sx?$/.test(path));
}

const BUILT = [
  '(tabs)/index.tsx',
  'office/[slug]/_layout.tsx',
  'office/[slug]/index.tsx',
  'c/[slug].tsx',
];

describe('the URL freeze', () => {
  it("the app's route files pass", () => {
    const files = appRouteFiles();
    expect(files).toContain('office/[slug]/index.tsx');
    expect(urlFreezeProblems(files)).toEqual([]);
  });

  it('a renamed office route fails', () => {
    const files = BUILT.map((file) =>
      file === 'office/[slug]/index.tsx' ? 'office/[id]/index.tsx' : file,
    );
    const problems = urlFreezeProblems(files);
    expect(problems).toEqual([
      '(a) /office/:slug is the shape of no route file',
      '(b) office/[id]/index.tsx has the shape /office/:id, which is no frozen shape nor under one',
    ]);
    expect(urlFreezeProblems([...BUILT, 'c/[slug-name].tsx'])).toEqual([
      '(b) c/[slug-name].tsx has the shape /c/:slug-name, which is no frozen shape nor under one',
    ]);
  });

  it('a sub-route passes', () => {
    expect(urlFreezeProblems([...BUILT, 'office/[slug]/run.tsx'])).toEqual([]);
    expect(urlFreezeProblems([...BUILT, 'c/[slug]/funding.tsx'])).toEqual([]);
  });

  it('a user route needs its shape', () => {
    const problems = urlFreezeProblems([...BUILT, 'u/[id].tsx']);
    expect(problems).toEqual([
      '(b) u/[id].tsx has the shape /u/:id, which is no frozen shape nor under one',
      '(c) app/u/ holds a route but not /u/:handle',
    ]);
    expect(urlFreezeProblems([...BUILT, 'u/[handle].tsx', 'p/[id]/index.tsx'])).toEqual([]);
  });

  it('routeShape reads a route file as its URL shape', () => {
    expect(
      [
        '(tabs)/index.tsx',
        'office/[slug]/index.tsx',
        'c/[slug].tsx',
        'c/[slug]/index.tsx',
        'settings/location.tsx',
        '_layout.tsx',
      ].map(routeShape),
    ).toEqual(['/', '/office/:slug', '/c/:slug', '/c/:slug', '/settings/location', null]);
    expect(['+not-found.tsx', '+native-intent.tsx', 'dev/gallery.tsx'].map(routeShape)).toEqual([
      null,
      null,
      null,
    ]);
  });
});
