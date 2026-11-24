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
  define: { __DEV__: 'true', 'process.env.EXPO_OS': '"web"' },
  resolve: {
    ...base.resolve,
    alias: { 'react-native': 'react-native-web', '@': src },
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js', '.json'],
    conditions: ['browser'],
  },
  test: {
    ...base.test,
    setupFiles: [...setupFilesOf(base), path.join(src, 'test', 'setup-dom.ts')],
    name: 'dom:mobile',
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
    server: {
      deps: {
        inline: [/^react-native/, /^@react-native\//, /^expo/, /^@expo\//, /^@shopify\/flash-list/],
      },
    },
  },
});
