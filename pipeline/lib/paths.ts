import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** The repository root: the first folder above this file that holds `pnpm-workspace.yaml`. */
export function repoRoot(): string {
  let dir = import.meta.dirname;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('repository root not found');
    }
    dir = parent;
  }
}

/** The repository's `data/` folder, the YAML the pipeline reads. */
export function dataDir(): string {
  return join(repoRoot(), 'data');
}
