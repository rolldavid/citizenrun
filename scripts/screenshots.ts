// The design-review captures at the four review viewports in light and dark:
//   tsx scripts/screenshots.ts --out <dir> [--routes <id,id,...>] [--base-url <url>] [--no-build]
// Without --base-url, Playwright's webServer starts the seeded stack (or reuses the one on 8080).
import { mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './lib/exec.ts';
import { repoRoot } from './lib/repo-root.ts';

export type ScreenshotArgs = {
  out: string;
  routes: readonly string[] | null;
  baseUrl: string | null;
  build: boolean;
};

export const USAGE =
  'usage: tsx scripts/screenshots.ts --out <dir> [--routes <id,id,...>] [--base-url <url>] [--no-build]';

/** A command-line mistake; its message is the usage text. */
export class UsageError extends Error {
  override name = 'UsageError';
  constructor() {
    super(USAGE);
  }
}

/** Parses the command line; `out` is made absolute against `cwd`. Throws UsageError. */
export function parseScreenshotArgs(argv: readonly string[], cwd: string): ScreenshotArgs {
  let out: string | null = null;
  let routes: string[] | null = null;
  let baseUrl: string | null = null;
  let noBuild = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--no-build') {
      noBuild = true;
      continue;
    }
    if (flag !== '--out' && flag !== '--routes' && flag !== '--base-url') {
      throw new UsageError();
    }
    index += 1;
    const value = argv[index];
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new UsageError();
    }
    if (flag === '--out') {
      out = resolve(cwd, value);
    } else if (flag === '--routes') {
      routes = value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== '');
      if (routes.length === 0) {
        throw new UsageError();
      }
    } else {
      baseUrl = value;
    }
  }
  if (out === null) {
    throw new UsageError();
  }
  return { out, routes, baseUrl, build: !noBuild && baseUrl === null };
}

/** The variables the capture spec and the screens config read. */
export function screenshotEnv(args: ScreenshotArgs): Record<string, string> {
  return {
    SCREENS_OUT: args.out,
    ...(args.routes === null ? {} : { SCREENS_ROUTES: args.routes.join(',') }),
    ...(args.baseUrl === null ? {} : { SCREENS_BASE_URL: args.baseUrl }),
  };
}

/** The PNG files in `dir` written at or after `since` (milliseconds). */
function writtenImages(dir: string, since: number): number {
  return readdirSync(dir).filter(
    (name) => name.endsWith('.png') && statSync(join(dir, name)).mtimeMs >= since,
  ).length;
}

export async function main(argv: readonly string[]): Promise<number> {
  let args: ScreenshotArgs;
  try {
    args = parseScreenshotArgs(argv, process.cwd());
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
  const root = repoRoot();
  mkdirSync(args.out, { recursive: true });
  if (args.build) {
    for (const script of ['build:web', 'build:api', 'build:worker']) {
      const built = await run('pnpm', [script], { cwd: root, inherit: true });
      if (built.code !== 0) {
        console.error(`screenshots: pnpm ${script} failed`);
        return built.code;
      }
    }
  }
  const started = Date.now();
  const result = await run(
    'pnpm',
    [
      '--filter',
      '@citizenrun/mobile',
      'exec',
      'playwright',
      'test',
      '-c',
      'playwright.screens.config.ts',
    ],
    { cwd: root, env: { ...process.env, ...screenshotEnv(args) }, inherit: true },
  );
  const images = writtenImages(args.out, started);
  console.log(`screenshots: ${String(images)} images in ${args.out}`);
  return result.code;
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
