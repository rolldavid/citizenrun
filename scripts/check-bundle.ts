import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';
import { writeFormatted } from './lib/format.ts';
import { repoRoot } from './lib/repo-root.ts';
import { formatTable } from './lib/table.ts';

const SizesSchema = z.strictObject({
  entry: z.number().int().nonnegative(),
  common: z.number().int().nonnegative(),
  route: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type RouteSizes = z.infer<typeof SizesSchema>;

/** The shape of `docs/perf/web-bundle.json` (D-164, D-448). */
export const BundleConfigSchema = z.strictObject({
  limitBytes: z.number().int().positive(),
  routes: z.array(z.string().min(1)).min(1),
  lazy: z.array(z.string().min(1)),
  baseline: z.record(z.string(), SizesSchema),
});
export type BundleConfig = z.infer<typeof BundleConfigSchema>;

/** One exported chunk: its file name, the modules its source map lists and its text. */
export type Chunk = { name: string; modules: readonly string[]; text: string };

/** The chunks one route loads, by file name, and the lazy modules found among them. */
export type RouteGroups = {
  route: string;
  routeFile: string | null;
  entry: string[];
  routeChunk: string | null;
  common: string[];
  lazyModules: string[];
};

export type RouteMeasure = {
  route: string;
  routeFile: string | null;
  sizes: RouteSizes;
  lazyModules: string[];
};

const APP_DIR = 'apps/mobile/app/';
const CHUNK_DIR = '_expo/static/js/web/';
const ROUTE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js'] as const;
const SCRIPT_TAG = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

/** The module paths that can hold a route: `apps/mobile/app/<route>` with each extension. */
function routeFileCandidates(route: string): string[] {
  return ROUTE_EXTENSIONS.map((extension) => `${APP_DIR}${route}${extension}`);
}

/** True when `module` is a route file under `apps/mobile/app/`; layouts (`_layout`) are not routes. */
function isRouteFile(module: string): boolean {
  if (!module.startsWith(APP_DIR)) {
    return false;
  }
  const base = module.slice(module.lastIndexOf('/') + 1);
  return !base.startsWith('_') && ROUTE_EXTENSIONS.some((extension) => base.endsWith(extension));
}

/** True when `module` matches a `lazy` pattern: the pattern starts the path or follows a `/`. */
export function matchesLazy(module: string, pattern: string): boolean {
  return module.startsWith(pattern) || module.includes(`/${pattern}`);
}

/** The file names of the chunks `index.html` loads with a script tag. */
export function entryChunkNames(html: string): string[] {
  const names: string[] = [];
  for (const match of html.matchAll(SCRIPT_TAG)) {
    const src = (match[1] ?? '').replace(/^\//, '');
    if (src.startsWith(CHUNK_DIR)) {
      const name = src.slice(CHUNK_DIR.length);
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

/**
 * Sorts a route's chunks into three groups (D-164): the entry chunks `index.html` loads,
 * the route chunk whose modules hold the route file, and the common chunks the route chunk names
 * that hold no other route file and no lazy module.
 */
export function groupChunks(
  route: string,
  chunks: readonly Chunk[],
  entryNames: readonly string[],
  lazy: readonly string[],
): RouteGroups {
  const candidates = routeFileCandidates(route);
  const holds = (chunk: Chunk): string | undefined =>
    chunk.modules.find((module) => candidates.includes(module));
  const entry = chunks.filter((chunk) => entryNames.includes(chunk.name));
  const routeChunk =
    chunks.find((chunk) => !entryNames.includes(chunk.name) && holds(chunk) !== undefined) ??
    entry.find((chunk) => holds(chunk) !== undefined) ??
    null;
  const routeFile = routeChunk === null ? null : (holds(routeChunk) ?? null);
  const isLazy = (module: string): boolean => lazy.some((pattern) => matchesLazy(module, pattern));
  const common =
    routeChunk === null
      ? []
      : chunks.filter(
          (chunk) =>
            !entryNames.includes(chunk.name) &&
            chunk.name !== routeChunk.name &&
            routeChunk.text.includes(chunk.name) &&
            !chunk.modules.some(
              (module) => (isRouteFile(module) && module !== routeFile) || isLazy(module),
            ),
        );
  const counted = [...entry, ...(routeChunk === null ? [] : [routeChunk]), ...common];
  const lazyModules = [
    ...new Set(counted.flatMap((chunk) => chunk.modules.filter((module) => isLazy(module)))),
  ].sort();
  return {
    route,
    routeFile,
    entry: entry.map((chunk) => chunk.name),
    routeChunk:
      routeChunk === null || entryNames.includes(routeChunk.name) ? null : routeChunk.name,
    common: common.map((chunk) => chunk.name),
    lazyModules,
  };
}

/** Sums the gzipped sizes of each group; `sizeOf` gives one chunk's gzipped bytes. */
export function sizeGroups(groups: RouteGroups, sizeOf: (name: string) => number): RouteSizes {
  const sum = (names: readonly string[]): number =>
    names.reduce((total, name) => total + sizeOf(name), 0);
  const entry = sum(groups.entry);
  const common = sum(groups.common);
  const route = groups.routeChunk === null ? 0 : sizeOf(groups.routeChunk);
  return { entry, common, route, total: entry + common + route };
}

/** One line per failure: a route with no chunk, a route at or over the limit, a lazy module loaded. */
export function bundleProblems(measures: readonly RouteMeasure[], limitBytes: number): string[] {
  const problems: string[] = [];
  for (const measure of measures) {
    if (measure.routeFile === null) {
      problems.push(
        `route ${measure.route}: no chunk holds ${routeFileCandidates(measure.route).join(', ')}`,
      );
    }
    if (measure.sizes.total >= limitBytes) {
      problems.push(
        `route ${measure.route}: ${String(measure.sizes.total)} gzipped bytes, the limit is under ${String(limitBytes)} (D-448)`,
      );
    }
    for (const module of measure.lazyModules) {
      problems.push(
        `route ${measure.route}: the lazy module ${module} is in the route's entry, common or route chunk (D-164)`,
      );
    }
  }
  return problems;
}

/** A source path as the source map writes it, made relative to the repository root. */
export function normaliseSource(source: string, root: string): string {
  const path = source.startsWith('file://') ? fileURLToPath(source) : source;
  if (isAbsolute(path) && path.startsWith(root + sep)) {
    return relative(root, path).split(sep).join('/');
  }
  return path.startsWith('/') ? path.slice(1) : path;
}

type SourceMap = { sources?: string[] | undefined; sections?: { map: SourceMap }[] | undefined };
const SourceMapSchema: z.ZodType<SourceMap> = z.lazy(() =>
  z.object({
    sources: z.array(z.string()).optional(),
    sections: z.array(z.object({ map: SourceMapSchema })).optional(),
  }),
);

/** The source paths a source map lists, including those of an indexed map's sections. */
export function sourcesOf(map: unknown): string[] {
  const walk = (current: SourceMap): string[] => [
    ...(current.sources ?? []),
    ...(current.sections ?? []).flatMap((section) => walk(section.map)),
  ];
  return walk(SourceMapSchema.parse(map));
}

/** Reads every chunk of the export with its module list from `<chunk>.js.map`. */
export function readChunks(distDir: string, root: string): Chunk[] {
  const chunkDir = join(distDir, CHUNK_DIR);
  if (!existsSync(chunkDir)) {
    return [];
  }
  return readdirSync(chunkDir)
    .filter((name) => name.endsWith('.js'))
    .sort()
    .map((name) => {
      const mapPath = join(chunkDir, `${name}.map`);
      if (!existsSync(mapPath)) {
        throw new Error(`${CHUNK_DIR}${name} has no source map; run pnpm build:web`);
      }
      const map: unknown = JSON.parse(readFileSync(mapPath, 'utf8'));
      const modules = [...new Set(sourcesOf(map).map((source) => normaliseSource(source, root)))];
      return { name, modules, text: readFileSync(join(chunkDir, name), 'utf8') };
    });
}

/** Gzipped bytes of one chunk at level 9. */
function gzippedSize(distDir: string, name: string): number {
  return gzipSync(readFileSync(join(distDir, CHUNK_DIR, name)), { level: 9 }).length;
}

/** Measures every route of `config` in the export at `distDir`. */
export function measureBundle(distDir: string, root: string, config: BundleConfig): RouteMeasure[] {
  const html = readFileSync(join(distDir, 'index.html'), 'utf8');
  const entryNames = entryChunkNames(html);
  const chunks = readChunks(distDir, root);
  return config.routes.map((route) => {
    const groups = groupChunks(route, chunks, entryNames, config.lazy);
    return {
      route,
      routeFile: groups.routeFile,
      sizes: sizeGroups(groups, (name) => gzippedSize(distDir, name)),
      lazyModules: groups.lazyModules,
    };
  });
}

/** The table of sizes and the change from the baseline. */
export function bundleTable(measures: readonly RouteMeasure[], config: BundleConfig): string {
  const rows = measures.map((measure) => {
    const baseline = config.baseline[measure.route];
    const change = baseline === undefined ? null : measure.sizes.total - baseline.total;
    return [
      measure.route,
      String(measure.sizes.entry),
      String(measure.sizes.common),
      String(measure.sizes.route),
      String(measure.sizes.total),
      baseline === undefined ? 'none' : String(baseline.total),
      change === null ? 'none' : change > 0 ? `+${String(change)}` : String(change),
    ];
  });
  return formatTable(
    ['route', 'entry', 'common', 'route chunk', 'total', 'baseline', 'change'],
    rows,
  );
}

/** The configuration with its baseline replaced by the measured sizes. */
export function withBaseline(
  config: BundleConfig,
  measures: readonly RouteMeasure[],
): BundleConfig {
  return {
    ...config,
    baseline: Object.fromEntries(measures.map((measure) => [measure.route, measure.sizes])),
  };
}

/** Writes the configuration with the measured baseline, formatted as the repository formats JSON. */
export async function writeBaseline(
  configPath: string,
  config: BundleConfig,
  measures: readonly RouteMeasure[],
): Promise<void> {
  await writeFormatted(configPath, `${JSON.stringify(withBaseline(config, measures), null, 2)}\n`);
}

/** Checks the web export against the budget; `--update` also rewrites the baseline. */
export async function main(args: readonly string[]): Promise<number> {
  const root = repoRoot();
  const configPath = join(root, 'docs/perf/web-bundle.json');
  const distDir = join(root, 'apps/mobile/dist');
  const parsed = BundleConfigSchema.safeParse(JSON.parse(readFileSync(configPath, 'utf8')));
  if (!parsed.success) {
    console.error(`docs/perf/web-bundle.json is not valid: ${z.prettifyError(parsed.error)}`);
    return 1;
  }
  if (!existsSync(join(distDir, 'index.html'))) {
    console.error('apps/mobile/dist/index.html does not exist; run pnpm build:web first');
    return 1;
  }
  const config = parsed.data;
  const measures = measureBundle(distDir, root, config);
  console.log(bundleTable(measures, config));
  if (args.includes('--update')) {
    await writeBaseline(configPath, config, measures);
    console.log('wrote the measured baseline to docs/perf/web-bundle.json');
  }
  const problems = bundleProblems(measures, config.limitBytes);
  for (const problem of problems) {
    console.error(problem);
  }
  return problems.length === 0 ? 0 : 1;
}

const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
