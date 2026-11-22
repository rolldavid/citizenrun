import { defineProject } from 'vitest/config';
import { TEST_ENV_FILE, runMarker } from '../../vitest.shared.ts';

export default defineProject({
  test: {
    name: 'unit:mobile',
    environment: 'node',
    include: ['src/**/*.test.ts', 'app.config.test.ts'],
    setupFiles: [TEST_ENV_FILE],
    restoreMocks: true,
    unstubEnvs: true,
    testTimeout: 5000,
    provide: { privacyMarker: runMarker() },
  },
  resolve: {
    alias: { 'react-native': 'react-native-web', '@': './src' },
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.web.js', '.js', '.json'],
  },
});
