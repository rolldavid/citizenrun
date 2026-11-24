import path from 'node:path';
import { defineConfig } from 'vitest/config';

import { unitProject } from '../../vitest.shared.ts';

const base = unitProject('mobile', import.meta.dirname);
const src = path.join(import.meta.dirname, 'src');

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
