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
      common: ['shared-ccc.js'],
      lazyModules: [],
    });
    const [measured] = measureBundle(distDir, root, CONFIG);
    const entry = gzipped('entry-aaa.js');
    const common = gzipped('shared-ccc.js');
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
      'route index: 500000 gzipped bytes, the limit is under 500000 (D-448)',
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
    expect(groups.common).toEqual(['shared-ccc.js']);
    const [measured] = measureBundle(distDir, root, CONFIG);
    expect(measured?.sizes.common).toBe(gzipped('shared-ccc.js'));
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
