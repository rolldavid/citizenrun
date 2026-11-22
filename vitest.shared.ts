import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';
import type { UserWorkspaceConfig } from 'vitest/config';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The run's privacy marker: `PRIVMARK` and 12 lower-case hex characters. */
    privacyMarker: string;
  }
}

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/** Absolute path of the allow-listed test environment, the first setup file of every project. */
export const TEST_ENV_FILE = resolve(ROOT, 'vitest.env.ts');

const DB_HARNESS_GLOBAL_SETUP = resolve(ROOT, 'packages/db/src/testing/global-setup.ts');
const DB_HARNESS_SETUP = resolve(ROOT, 'packages/db/src/testing/setup.ts');

// Vite bundles each project's config with its own copy of this module, so a value made at module
// level would differ per project. Both values below live in the main process's environment, and
// the VITEST prefix keeps them through vitest.env.ts in the workers.

/** The one privacy marker of this run, made on first call. */
export function runMarker(): string {
  return (process.env.VITEST_RUN_MARKER ??= `PRIVMARK${randomBytes(6).toString('hex')}`);
}

/** The run's shuffle seed when TEST_SHUFFLE is 1, printed once when it is made; otherwise null. */
export function shuffleSeed(): number | null {
  if (process.env.TEST_SHUFFLE !== '1') {
    return null;
  }
  let seed = process.env.VITEST_SHUFFLE_SEED;
  if (seed === undefined) {
    seed = String(Date.now() % 2147483647);
    process.env.VITEST_SHUFFLE_SEED = seed;
    console.log(`vitest shuffle seed ${seed}`);
  }
  return Number(seed);
}

type Harness = 'db' | 'storage';

// Vitest reads the seed from the root configuration only (vitest.config.ts sets it); a project
// can only switch shuffling on for its own tests.
function common(name: string, dir: string) {
  return {
    name,
    root: dir,
    environment: 'node' as const,
    provide: { privacyMarker: runMarker() },
    ...(shuffleSeed() === null ? {} : { sequence: { shuffle: true } }),
  };
}

function harnessFiles(harness: Harness, dir: string): { globalSetup: string; setup: string } {
  if (harness === 'db') {
    return { globalSetup: DB_HARNESS_GLOBAL_SETUP, setup: DB_HARNESS_SETUP };
  }
  return {
    globalSetup: resolve(dir, 'testing/global-setup.ts'),
    setup: resolve(dir, 'testing/setup.ts'),
  };
}

/** The `unit:<name>` project: every `*.test.ts(x)` under `dir`, no services. */
export function unitProject(name: string, dir: string): UserWorkspaceConfig {
  return defineProject({
    test: {
      ...common(`unit:${name}`, dir),
      include: ['**/*.test.{ts,tsx}'],
      exclude: [
        '**/*.int.test.ts',
        '**/*.media.test.ts',
        '**/dist/**',
        '**/e2e/**',
        '**/node_modules/**',
      ],
      setupFiles: [TEST_ENV_FILE],
      restoreMocks: true,
      unstubEnvs: true,
      testTimeout: 5000,
    },
  });
}

/** The `int:<name>` project: every `*.int.test.ts` under `dir`, with the database or storage harness. */
export function intProject(
  name: string,
  dir: string,
  options?: { harness?: Harness },
): UserWorkspaceConfig {
  const files = harnessFiles(options?.harness ?? 'db', dir);
  return defineProject({
    test: {
      ...common(`int:${name}`, dir),
      include: ['**/*.int.test.ts'],
      globalSetup: files.globalSetup,
      setupFiles: [TEST_ENV_FILE, files.setup],
      pool: 'forks',
      maxWorkers: 4,
      testTimeout: 20000,
      hookTimeout: 60000,
    },
  });
}

/** The `media:<name>` project: every `*.media.test.ts` under `dir`, with the database harness. */
export function mediaProject(name: string, dir: string): UserWorkspaceConfig {
  const files = harnessFiles('db', dir);
  return defineProject({
    test: {
      ...common(`media:${name}`, dir),
      include: ['**/*.media.test.ts'],
      globalSetup: files.globalSetup,
      setupFiles: [TEST_ENV_FILE, files.setup],
      pool: 'forks',
      maxWorkers: 2,
      testTimeout: 300000,
      hookTimeout: 120000,
    },
  });
}
