import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './repo-root.ts';

describe('repoRoot', () => {
  it('finds the folder that holds pnpm-workspace.yaml', () => {
    const root = repoRoot();
    expect(isAbsolute(root)).toBe(true);
    expect(existsSync(join(root, 'pnpm-workspace.yaml'))).toBe(true);
    const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    expect(manifest).toMatchObject({ name: 'citizenrun' });
  });
});
