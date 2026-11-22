import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { shuffleSeed } from './vitest.shared.ts';

// The final project list. Vitest refuses an entry that names a missing file, so an entry with no
// glob character is kept only once its file exists.
const PROJECTS = [
  'packages/*/vitest.config.ts',
  'packages/*/vitest.int.config.ts',
  'apps/*/vitest.config.ts',
  'apps/*/vitest.int.config.ts',
  'apps/mobile/vitest.dom.config.ts',
  'pipeline/vitest.config.ts',
  'pipeline/vitest.int.config.ts',
  'scripts/vitest.config.ts',
];

const present = (entry: string): boolean =>
  /[*?{[]/.test(entry) || existsSync(resolve(import.meta.dirname, entry));

// With TEST_SHUFFLE=1 the order of files and tests follows one printed seed (TC-02); Vitest takes
// the seed from this root configuration only.
const seed = shuffleSeed();

export default defineConfig({
  test: {
    projects: PROJECTS.filter(present),
    ...(seed === null ? {} : { sequence: { shuffle: true, seed } }),
  },
});
