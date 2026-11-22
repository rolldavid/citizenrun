import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Absolute path of the repository root: the nearest folder above this file holding pnpm-workspace.yaml. */
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
