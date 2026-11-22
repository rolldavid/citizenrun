import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import expo from 'eslint-config-expo/flat.js';
import tseslint from 'typescript-eslint';

import { baseline } from './scripts/eslint/baseline.ts';
import { citizenrun } from './scripts/eslint/index.ts';
import { restrictedImports } from './scripts/eslint/restricted-imports.ts';

const APP = ['apps/mobile/app/**/*.{ts,tsx}', 'apps/mobile/src/**/*.{ts,tsx}'];
const CARDS = ['packages/cards/src/**/*.{ts,tsx}'];
const TESTS = [
  '**/*.test.{ts,tsx}',
  '**/*.int.test.ts',
  '**/*.fixtures.ts',
  '**/*.fixtures.tsx',
  '**/__fixtures__/**',
  '**/testing/**',
  'apps/mobile/src/test/**',
  'apps/mobile/e2e/**',
];

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.expo/**',
    'apps/mobile/ios/**',
    'apps/mobile/android/**',
    'apps/mobile/public/**',
    'apps/mobile/expo-env.d.ts',
    '**/playwright-report/**',
    '**/test-results/**',
    'packages/shared/src/api/**',
    'packages/shared/src/brand.ts',
    'packages/cards/src/generated/**',
    'packages/shared/src/legal/source-credits.ts',
    'apps/api/openapi.json',
    'apps/api/assets/**',
    'plans/**',
    'ml/**',
    '.review-evidence/**',
    '.claude/**',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  { files: [...APP, ...CARDS], extends: [expo] },
  ...baseline,
  { plugins: { citizenrun }, rules: citizenrun.configs.all },
  ...restrictedImports,
  { files: TESTS, rules: citizenrun.configs.tests },
  {
    files: ['apps/mobile/*.config.ts', 'apps/mobile/app.config.test.ts', 'apps/mobile/e2e/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: ['./apps/mobile/tsconfig.node.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  { files: ['**/*.cjs', '**/*.mjs', '**/*.js'], extends: [tseslint.configs.disableTypeChecked] },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: { __dirname: 'readonly', __filename: 'readonly', process: 'readonly' },
    },
  },
]);
