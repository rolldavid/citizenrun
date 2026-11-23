// Bundles one service entry into a single ESM file with esbuild:
//   tsx ../../scripts/build-service.ts <entry> <outfile> [--no-externals]
// run from a package folder, paths relative to it. Everything but the native binaries and the
// optional requires below goes inside the bundle (D-022, D-150).
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { Metafile } from 'esbuild';

/** Native binaries: never bundled, so they resolve from the built package's node_modules. */
export const NATIVE_EXTERNALS = ['sharp', 'onnxruntime-node', '@resvg/resvg-js'] as const;

/** Optional requires that are never installed; a bundle keeps their lazy require external. */
export const OPTIONAL_EXTERNALS = ['pg-native', 'bufferutil', 'utf-8-validate'] as const;

/** Gives bundled CommonJS code require, __filename and __dirname inside an ESM file. */
export const BANNER =
  "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __fu(new URL('.', import.meta.url));";

export type BuildArgs = { entry: string; outfile: string; noExternals: boolean };

const USAGE = 'tsx ../../scripts/build-service.ts <entry> <outfile> [--no-externals]';

/** A command-line mistake; the script prints one usage line and exits 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** Parses `<entry> <outfile> [--no-externals]`; throws UsageError on anything else. */
export function parseBuildArgs(argv: readonly string[]): BuildArgs {
  const positional: string[] = [];
  let noExternals = false;
  for (const arg of argv) {
    if (arg === '--no-externals') {
      if (noExternals) {
        throw new UsageError('--no-externals is given twice');
      }
      noExternals = true;
    } else if (arg.startsWith('--')) {
      throw new UsageError(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  const [entry, outfile] = positional;
  if (positional.length !== 2 || entry === undefined || outfile === undefined) {
    throw new UsageError(
      `expected an entry and an outfile, got ${String(positional.length)} paths`,
    );
  }
  return { entry, outfile, noExternals };
}

/** The package an import path names: `@scope/name` for a scoped path, else its first segment. */
export function packageNameOf(importPath: string): string {
  const segments = importPath.split('/');
  if (importPath.startsWith('@') && segments.length >= 2) {
    return `${segments[0] ?? ''}/${segments[1] ?? ''}`;
  }
  return segments[0] ?? importPath;
}

function isNativeExternal(name: string): boolean {
  return (NATIVE_EXTERNALS as readonly string[]).includes(name);
}

/** The problems with a bundle's external imports; an empty list when there are none. */
export function checkExternals(
  metafile: Metafile,
  directDependencies: ReadonlySet<string>,
  noExternals: boolean,
): string[] {
  const natives = new Set<string>();
  for (const output of Object.values(metafile.outputs)) {
    for (const imported of output.imports) {
      if (imported.external !== true) {
        continue;
      }
      const name = packageNameOf(imported.path);
      if (isNativeExternal(name)) {
        natives.add(name);
      }
    }
  }
  const problems: string[] = [];
  for (const name of [...natives].sort()) {
    if (noExternals) {
      problems.push(`${name} is imported but --no-externals was given`);
    } else if (!directDependencies.has(name)) {
      problems.push(`${name} is imported but is not a dependency of the package`);
    }
  }
  return problems;
}

/** The `dependencies` keys (never `devDependencies`) of the nearest package.json above a file. */
function directDependenciesOf(file: string): Set<string> {
  let dir = dirname(file);
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
      const dependencies =
        typeof parsed === 'object' && parsed !== null && 'dependencies' in parsed
          ? parsed.dependencies
          : undefined;
      return new Set(
        typeof dependencies === 'object' && dependencies !== null ? Object.keys(dependencies) : [],
      );
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return new Set();
    }
    dir = parent;
  }
}

/** Bundles the entry, writes `<outfile>.map` and `<outfile>.meta.json`, and exits 1 on a problem. */
export async function buildService(args: BuildArgs, cwd: string): Promise<void> {
  const result = await build({
    entryPoints: [args.entry],
    outfile: args.outfile,
    absWorkingDir: cwd,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    sourcemap: 'linked',
    minify: false,
    external: [...NATIVE_EXTERNALS, ...OPTIONAL_EXTERNALS],
    banner: { js: BANNER },
    metafile: true,
    logLevel: 'warning',
  });
  const outfile = resolve(cwd, args.outfile);
  writeFileSync(`${outfile}.meta.json`, `${JSON.stringify(result.metafile, null, 2)}\n`);
  const problems = checkExternals(
    result.metafile,
    directDependenciesOf(resolve(cwd, args.entry)),
    args.noExternals,
  );
  if (problems.length > 0) {
    for (const problem of problems) {
      console.error(problem);
    }
    process.exit(1);
  }
}

async function main(argv: readonly string[]): Promise<number> {
  let args: BuildArgs;
  try {
    args = parseBuildArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`usage: ${error.message}; ${USAGE}\n`);
      return 2;
    }
    throw error;
  }
  try {
    await buildService(args, process.cwd());
  } catch (error) {
    // esbuild has printed its build errors (logLevel 'warning'); any other error propagates.
    if (error instanceof Error && 'errors' in error && Array.isArray(error.errors)) {
      return 1;
    }
    throw error;
  }
  return 0;
}

const invoked = process.argv[1];
if (invoked !== undefined && realpathSync(invoked) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
