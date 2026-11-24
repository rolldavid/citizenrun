import path from 'node:path';
import { defineConfig } from 'vitest/config';

import { unitProject } from '../../vitest.shared.ts';

const base = unitProject('mobile', import.meta.dirname);
const src = path.join(import.meta.dirname, 'src');

export default defineConfig({
  ...base,
  resolve: {
    ...base.resolve,
    alias: { 'react-native': 'react-native-web', '@': src },
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js', '.json'],
  },
  test: {
    ...base.test,
    include: ['src/**/*.test.ts', 'app.config.test.ts'],
  },
});
