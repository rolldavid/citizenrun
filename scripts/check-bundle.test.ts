import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type BundleConfig,
  type RouteMeasure,
  BundleConfigSchema,
  bundleProblems,
  entryChunkNames,
  groupChunks,
  measureBundle,
  normaliseSource,
  readChunks,
  sizeGroups,
  sourcesOf,
  writeBaseline,
} from './check-bundle.ts';

const CHUNK_DIR = '_expo/static/js/web';
const LAZY = [
  'node_modules/maplibre-gl/',
  'node_modules/@cantoo/pdf-lib/',
  'apps/mobile/app/admin/',
];
const MAPLIBRE_MODULE = 'node_modules/.pnpm/maplibre-gl@6.18.0/node_modules/maplibre-gl/dist/x.js';

const CONFIG: BundleConfig = {
  limitBytes: 500000,
  routes: ['index'],
  lazy: LAZY,
  baseline: { index: { entry: 0, common: 0, route: 0, total: 0 } },
};

let root: string;
let distDir: string;

/** Writes a chunk and its indexed source map, with sources in Metro's server-root form. */
function writeChunk(name: string, text: string, sources: readonly string[]): void {
  writeFileSync(join(distDir, CHUNK_DIR, name), text);
  const map = {
    version: 3,
    sections: sources.map((source, line) => ({
      offset: { line, column: 0 },
      map: { version: 3, sources: [source], names: [], mappings: '' },
    })),
  };
  writeFileSync(join(distDir, CHUNK_DIR, `${name}.map`), JSON.stringify(map));
}

/** An export of one entry chunk, a root layout, the `index` route and three chunks it names. */
function writeFixtureExport(
  routeSources: readonly string[] = ['/apps/mobile/app/index.tsx'],
): void {
  writeFileSync(
    join(distDir, 'index.html'),
    `<!doctype html><html><head></head><body><div id="root"></div><script src="/${CHUNK_DIR}/entry-aaa.js" defer></script></body></html>`,
  );
  writeChunk('entry-aaa.js', 'var entry="_layout-fff.js index-bbb.js";'.repeat(20), [
    '__prelude__',
    '/node_modules/.pnpm/react@19.3.0/node_modules/react/index.js',
    '/apps/mobile/index.ts',
  ]);
  writeChunk('_layout-fff.js', 'var layout=1;', ['/apps/mobile/app/_layout.tsx']);
  writeChunk(
    'index-bbb.js',
    'var route=["shared-ccc.js","other-ddd.js","map-eee.js"];',
    routeSources,
  );
  writeChunk('shared-ccc.js', 'var shared="common code";'.repeat(5), [
    '/packages/shared/src/index.ts',
    '/packages/shared/src/common.ts',
  ]);
  writeChunk('other-ddd.js', 'var other="another route";'.repeat(9), [
    '/apps/mobile/app/explore.tsx',
    '/packages/shared/src/other.ts',
  ]);
  writeChunk('map-eee.js', 'var map="lazy map";', [`/${MAPLIBRE_MODULE}`]);
}

function gzipped(name: string): number {
  return gzipSync(readFileSync(join(distDir, CHUNK_DIR, name)), { level: 9 }).length;
}

function measure(total: number, lazyModules: string[] = []): RouteMeasure {
  return {
    route: 'index',
    routeFile: 'apps/mobile/app/index.tsx',
    sizes: { entry: total, common: 0, route: 0, total },
    lazyModules,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'check-bundle-'));
  distDir = join(root, 'apps/mobile/dist');
  mkdirSync(join(distDir, CHUNK_DIR), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('check-bundle', () => {
  it('groups entry, route and common chunks', () => {
    writeFixtureExport();
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    const groups = groupChunks('index', readChunks(distDir, root), entryChunkNames(html), LAZY);
    expect(groups).toEqual({
      route: 'index',
      routeFile: 'apps/mobile/app/index.tsx',
      entry: ['entry-aaa.js'],
      routeChunk: 'index-bbb.js',
      common: ['_layout-fff.js', 'shared-ccc.js'],
      lazyModules: [],
    });
    const [measured] = measureBundle(distDir, root, CONFIG);
    const entry = gzipped('entry-aaa.js');
    const common = gzipped('_layout-fff.js') + gzipped('shared-ccc.js');
    const route = gzipped('index-bbb.js');
    expect(measured).toEqual({
      route: 'index',
      routeFile: 'apps/mobile/app/index.tsx',
      sizes: { entry, common, route, total: entry + common + route },
      lazyModules: [],
    });
    expect(bundleProblems(measureBundle(distDir, root, CONFIG), CONFIG.limitBytes)).toEqual([]);
  });

  it('the limit is 500,000 bytes, inclusive', () => {
    expect(bundleProblems([measure(500000)], 500000)).toEqual([
      'route index: 500000 gzipped bytes, the limit is under 500000 (D-448, D-822)',
    ]);
    expect(bundleProblems([measure(499999)], 500000)).toEqual([]);
  });

  it("a lazy module in a route's graph fails", () => {
    writeFixtureExport(['/apps/mobile/app/index.tsx', `/${MAPLIBRE_MODULE}`]);
    const measures = measureBundle(distDir, root, CONFIG);
    expect(measures[0]?.lazyModules).toEqual([MAPLIBRE_MODULE]);
    expect(bundleProblems(measures, CONFIG.limitBytes)).toEqual([
      `route index: the lazy module ${MAPLIBRE_MODULE} is in the route's entry, common or route chunk (D-164)`,
    ]);
  });

  it('finds a nested bracketed route', () => {
    writeFixtureExport(['/apps/mobile/app/office/[slug]/index.tsx']);
    writeChunk('_layout-ggg.js', 'var officeLayout=1;', [
      '/apps/mobile/app/office/[slug]/_layout.tsx',
    ]);
    writeChunk('_layout-hhh.js', 'var otherLayout=1;', [
      '/apps/mobile/app/office/[id]/_layout.tsx',
    ]);
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    const chunks = readChunks(distDir, root);
    const groups = groupChunks('office/[slug]/index', chunks, entryChunkNames(html), LAZY);
    expect(groups).toEqual({
      route: 'office/[slug]/index',
      routeFile: 'apps/mobile/app/office/[slug]/index.tsx',
      entry: ['entry-aaa.js'],
      routeChunk: 'index-bbb.js',
      common: ['_layout-fff.js', '_layout-ggg.js', 'shared-ccc.js'],
      lazyModules: [],
    });
    // The brackets are literal characters: they match no other segment, as a glob's would.
    expect(groupChunks('office/[sl]/index', chunks, entryChunkNames(html), LAZY).routeFile).toBe(
      null,
    );
    const config = { ...CONFIG, routes: ['(tabs)/index', 'office/[slug]/index'] };
    const measures = measureBundle(distDir, root, config);
    expect(measures.map((measured) => measured.routeFile)).toEqual([
      null,
      'apps/mobile/app/office/[slug]/index.tsx',
    ]);
  });

  it('a lazy module in the office route fails', () => {
    writeFixtureExport(['/apps/mobile/app/office/[slug]/index.tsx', `/${MAPLIBRE_MODULE}`]);
    const config = { ...CONFIG, routes: ['office/[slug]/index'] };
    const measures = measureBundle(distDir, root, config);
    expect(bundleProblems(measures, config.limitBytes)).toEqual([
      `route office/[slug]/index: the lazy module ${MAPLIBRE_MODULE} is in the route's entry, common or route chunk (D-164)`,
    ]);
  });

  it('a lazy module in the entry chunk fails', () => {
    const chunks = [
      { name: 'entry.js', modules: ['apps/mobile/index.ts', MAPLIBRE_MODULE], text: '' },
      { name: 'index.js', modules: ['apps/mobile/app/index.tsx'], text: '' },
    ];
    expect(groupChunks('index', chunks, ['entry.js'], LAZY).lazyModules).toEqual([MAPLIBRE_MODULE]);
  });

  it('a chunk the route names that holds a lazy module is neither common nor a failure', () => {
    writeFixtureExport();
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    const groups = groupChunks('index', readChunks(distDir, root), entryChunkNames(html), LAZY);
    expect(groups.common).not.toContain('map-eee.js');
    expect(groups.lazyModules).toEqual([]);
  });

  it('a common chunk that holds another route is not counted', () => {
    writeFixtureExport();
    const html = readFileSync(join(distDir, 'index.html'), 'utf8');
    const groups = groupChunks('index', readChunks(distDir, root), entryChunkNames(html), LAZY);
    expect(groups.common).toEqual(['_layout-fff.js', 'shared-ccc.js']);
    const [measured] = measureBundle(distDir, root, CONFIG);
    expect(measured?.sizes.common).toBe(gzipped('_layout-fff.js') + gzipped('shared-ccc.js'));
  });

  it("the layout chunks of a route's ancestors count as common", () => {
    const chunks = [
      {
        name: 'entry.js',
        modules: ['apps/mobile/index.ts'],
        text: '"_layout-root.js","_layout-office.js","_layout-slug.js","_layout-explore.js"',
      },
      {
        name: '_layout-root.js',
        modules: ['apps/mobile/app/_layout.tsx'],
        text: 'var root="_layout-explore.js";',
      },
      { name: '_layout-office.js', modules: ['apps/mobile/app/office/_layout.tsx'], text: '' },
      { name: '_layout-slug.js', modules: ['apps/mobile/app/office/[slug]/_layout.ts'], text: '' },
      { name: '_layout-explore.js', modules: ['apps/mobile/app/explore/_layout.tsx'], text: '' },
      { name: 'index.js', modules: ['apps/mobile/app/office/[slug]/index.tsx'], text: '' },
    ];
    const groups = groupChunks('office/[slug]/index', chunks, ['entry.js'], LAZY);
    expect(groups).toEqual({
      route: 'office/[slug]/index',
      routeFile: 'apps/mobile/app/office/[slug]/index.tsx',
      entry: ['entry.js'],
      routeChunk: 'index.js',
      common: ['_layout-root.js', '_layout-office.js', '_layout-slug.js'],
      lazyModules: [],
    });
    const bytes: Record<string, number> = {
      'entry.js': 1000,
      '_layout-root.js': 300,
      '_layout-office.js': 20,
      '_layout-slug.js': 4,
      '_layout-explore.js': 50000,
      'index.js': 7,
    };
    expect(sizeGroups(groups, (name) => bytes[name] ?? 0)).toEqual({
      entry: 1000,
      common: 324,
      route: 7,
      total: 1331,
    });
    expect(groupChunks('index', chunks, ['entry.js'], LAZY).common).toEqual(['_layout-root.js']);
  });

  it('a layout inside an entry chunk is not counted twice', () => {
    const chunks = [
      {
        name: 'entry.js',
        modules: ['apps/mobile/index.ts', 'apps/mobile/app/_layout.tsx'],
        text: '"index.js"',
      },
      { name: 'index.js', modules: ['apps/mobile/app/index.tsx'], text: '' },
    ];
    const groups = groupChunks('index', chunks, ['entry.js'], LAZY);
    expect(groups.entry).toEqual(['entry.js']);
    expect(groups.common).toEqual([]);
    expect(groups.routeChunk).toBe('index.js');
  });

  it('a lazy module in a layout chunk fails', () => {
    const chunks = [
      { name: 'entry.js', modules: ['apps/mobile/index.ts'], text: '"_layout.js","index.js"' },
      { name: '_layout.js', modules: ['apps/mobile/app/_layout.tsx', MAPLIBRE_MODULE], text: '' },
      { name: 'index.js', modules: ['apps/mobile/app/index.tsx'], text: '' },
    ];
    const groups = groupChunks('index', chunks, ['entry.js'], LAZY);
    expect(groups.common).toEqual(['_layout.js']);
    expect(groups.lazyModules).toEqual([MAPLIBRE_MODULE]);
    const measured: RouteMeasure = {
      route: 'index',
      routeFile: groups.routeFile,
      sizes: sizeGroups(groups, () => 1),
      lazyModules: groups.lazyModules,
    };
    expect(bundleProblems([measured], CONFIG.limitBytes)).toEqual([
      `route index: the lazy module ${MAPLIBRE_MODULE} is in the route's entry, common or route chunk (D-164)`,
    ]);
  });

  it('a chunk a layout chunk names counts as common', () => {
    const chunks = [
      { name: 'entry.js', modules: ['apps/mobile/index.ts'], text: '"_layout.js","index.js"' },
      {
        name: '_layout.js',
        modules: ['apps/mobile/app/_layout.tsx'],
        text: 'var named=["vendor.js","map.js","explore.js"];',
      },
      { name: 'vendor.js', modules: ['packages/shared/src/index.ts'], text: '' },
      { name: 'map.js', modules: [MAPLIBRE_MODULE], text: '' },
      { name: 'explore.js', modules: ['apps/mobile/app/explore.tsx'], text: '' },
      { name: 'index.js', modules: ['apps/mobile/app/index.tsx'], text: '' },
    ];
    const groups = groupChunks('index', chunks, ['entry.js'], LAZY);
    expect(groups.common).toEqual(['_layout.js', 'vendor.js']);
    expect(groups.lazyModules).toEqual([]);
  });

  it('a route no chunk holds is reported', () => {
    writeFixtureExport(['/apps/mobile/app/elsewhere.tsx']);
    const measures = measureBundle(distDir, root, CONFIG);
    expect(measures[0]?.routeFile).toBeNull();
    expect(bundleProblems(measures, CONFIG.limitBytes)).toEqual([
      'route index: no chunk holds apps/mobile/app/index.tsx, apps/mobile/app/index.ts, apps/mobile/app/index.jsx, apps/mobile/app/index.js',
    ]);
  });

  it('update writes the measured baseline', async () => {
    writeFixtureExport();
    const configPath = join(root, 'web-bundle.json');
    writeFileSync(configPath, JSON.stringify(CONFIG));
    const measures = measureBundle(distDir, root, CONFIG);
    await writeBaseline(configPath, CONFIG, measures);
    const written = BundleConfigSchema.parse(JSON.parse(readFileSync(configPath, 'utf8')));
    expect(written).toEqual({ ...CONFIG, baseline: { index: measures[0]?.sizes } });
    expect(written.baseline.index?.total).toBeGreaterThan(0);
  });

  it('reads the script tags of index.html under the chunk folder only', () => {
    const html =
      '<script src="/_expo/static/js/web/a.js" defer></script><script src="https://example.test/x.js"></script><script src="_expo/static/js/web/b.js"></script>';
    expect(entryChunkNames(html)).toEqual(['a.js', 'b.js']);
  });

  it('normalises source paths to the repository root', () => {
    expect(normaliseSource('/apps/mobile/app/index.tsx', root)).toBe('apps/mobile/app/index.tsx');
    expect(normaliseSource(join(root, 'packages/shared/src/x.ts'), root)).toBe(
      'packages/shared/src/x.ts',
    );
    expect(normaliseSource(pathToFileURL(join(root, 'a/b.ts')).href, root)).toBe('a/b.ts');
    expect(normaliseSource('__prelude__', root)).toBe('__prelude__');
  });

  it('lists the sources of plain and indexed source maps', () => {
    expect(sourcesOf({ version: 3, sources: ['/a.ts', '/b.ts'] })).toEqual(['/a.ts', '/b.ts']);
    expect(
      sourcesOf({
        version: 3,
        sections: [
          { map: { sources: ['/a.ts'] } },
          { map: { sections: [{ map: { sources: ['/c.ts'] } }] } },
        ],
      }),
    ).toEqual(['/a.ts', '/c.ts']);
  });
});
