import { isAbsolute, relative, sep } from 'node:path';
import { repoRoot } from '../lib/repo-root.ts';
import { globToRegExp } from './glob.ts';

const ROOT = repoRoot();
const compiled = new Map<string, RegExp>();

/** The path of a linted file relative to the repository root, with `/` separators. */
export function repoRelative(filename: string): string {
  const rel = isAbsolute(filename) ? relative(ROOT, filename) : filename;
  return rel.split(sep).join('/').replace(/^\.\//, '');
}

/** True when the repository-relative path matches one of the globs. */
export function matchesAny(relPath: string, globs: readonly string[]): boolean {
  return globs.some((glob) => {
    let pattern = compiled.get(glob);
    if (pattern === undefined) {
      pattern = globToRegExp(glob);
      compiled.set(glob, pattern);
    }
    return pattern.test(relPath);
  });
}

/** The test and fixture globs, where the text and token rules are off. */
export const TEST_GLOBS = [
  '**/*.test.{ts,tsx}',
  '**/*.int.test.ts',
  '**/*.fixtures.ts',
  '**/*.fixtures.tsx',
  '**/__fixtures__/**',
  '**/testing/**',
  'apps/mobile/src/test/**',
  'apps/mobile/e2e/**',
] as const;
