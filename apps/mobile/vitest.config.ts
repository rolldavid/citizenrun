import path from 'node:path';
import { defineConfig } from 'vitest/config';

import { unitProject } from '../../vitest.shared.ts';

const base = unitProject('mobile', import.meta.dirname);
const src = path.join(import.meta.dirname, 'src');

// The factory's setup files (vitest.env.ts first), then this project's own.
function setupFilesOf(config: typeof base): string[] {
  const files = config.test?.setupFiles ?? [];
  return typeof files === 'string' ? [files] : files;
}

export default defineConfig({
  ...base,
  resolve: {
    ...base.resolve,
    alias: { 'react-native': 'react-native-web', '@': src },
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js', '.json'],
  },
  test: {
    ...base.test,
    setupFiles: [...setupFilesOf(base), path.join(src, 'test', 'setup-unit.ts')],
    include: ['src/**/*.test.ts', 'app.config.test.ts'],
  },
});
