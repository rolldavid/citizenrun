import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './lib/repo-root.ts';

const ROOT = repoRoot();
const SKIPPED_FOLDERS = new Set(['node_modules', 'dist', '.expo', 'ios', 'android']);
const SKIPPED_PATHS = new Set(['packages/shared/src/api']);

/** Every `.ts` and `.tsx` file under `apps/` and `packages/`, relative to the root. */
function sourceFiles(): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      const rel = relative(ROOT, path);
      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name) && !SKIPPED_PATHS.has(rel)) {
          visit(path);
        }
      } else if (/\.tsx?$/.test(entry.name)) {
        found.push(rel);
      }
    }
  };
  visit(join(ROOT, 'apps'));
  visit(join(ROOT, 'packages'));
  return found.sort();
}

describe('source rules', () => {
  it('scans the source files of the packages', () => {
    expect(sourceFiles()).toContain('packages/shared/src/index.ts');
  });

  it('no compact notation through Intl', () => {
    const pattern = /notation\s*:\s*['"]compact['"]/;
    const offenders = sourceFiles().filter((file) =>
      pattern.test(readFileSync(join(ROOT, file), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
