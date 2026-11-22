import type { Linter } from 'eslint';

const APP_AND_CARDS = [
  'apps/mobile/app/**/*.{ts,tsx}',
  'apps/mobile/src/**/*.{ts,tsx}',
  'packages/cards/src/**/*.{ts,tsx}',
];

type Selector = { selector: string; message: string };

const DEFAULT_EXPORT: Selector[] = [
  {
    selector: 'ExportDefaultDeclaration',
    message: 'A default export is allowed only in route files and tool configuration files.',
  },
];
const REQUIRE: Selector[] = [
  {
    selector: "CallExpression[callee.name='require']",
    message: 'Use import: require() is allowed only in .cjs files and apps/mobile/app.config.ts.',
  },
  {
    selector: "AssignmentExpression[left.object.name='module'][left.property.name='exports']",
    message:
      'Use export: module.exports is allowed only in .cjs files and apps/mobile/app.config.ts.',
  },
];
const SQL_RAW: Selector[] = [
  {
    selector: "CallExpression[callee.object.name='sql'][callee.property.name='raw']",
    message: 'sql.raw is allowed only in packages/db/src/sql and the migrations (CTL-04).',
  },
];
const FOCUS: Selector[] = [
  {
    selector:
      'CallExpression[callee.object.name=/^(it|test|describe)$/][callee.property.name=/^(only|skip|tod[o])$/]',
    message: 'No focused, skipped or pending tests: every test runs.',
  },
  {
    selector: 'CallExpression[callee.name=/^(xit|xdescribe)$/]',
    message: 'No focused, skipped or pending tests: every test runs.',
  },
];

/** One no-restricted-syntax entry; a later entry replaces an earlier one for the files it matches. */
function syntax(files: string[] | null, groups: Selector[][]): Linter.Config {
  return {
    ...(files === null ? {} : { files }),
    rules: { 'no-restricted-syntax': ['error', ...groups.flat()] },
  };
}

/** The baseline rules, placed after the presets so that they win. */
export const baseline: Linter.Config[] = [
  {
    name: 'citizenrun/baseline',
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    name: 'citizenrun/baseline/no-console',
    ignores: [
      'scripts/**',
      '**/*.config.*',
      'vitest.shared.ts',
      'vitest.env.ts',
      'pipeline/cli.ts',
      'packages/shared/src/log/logger.ts',
    ],
    rules: { 'no-console': 'error' },
  },
  {
    name: 'citizenrun/baseline/process-env',
    ignores: [
      '**/env.ts',
      'apps/mobile/app.config.ts',
      '**/*.config.*',
      'vitest.shared.ts',
      'vitest.env.ts',
      'scripts/**',
      'apps/mobile/e2e/**',
      'packages/db/src/testing/**',
      'pipeline/testing/**',
    ],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read the environment only in the env module of the service.',
        },
      ],
    },
  },
  {
    name: 'citizenrun/baseline/no-danger',
    files: APP_AND_CARDS,
    rules: { 'react/no-danger': 'error' },
  },
  {
    name: 'citizenrun/baseline/require-allowed',
    files: ['apps/mobile/app.config.ts', '**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  syntax(null, [DEFAULT_EXPORT, REQUIRE, SQL_RAW, FOCUS]),
  syntax(
    ['apps/mobile/app/**', '**/*.config.{ts,mjs}', '.railway/railway.ts'],
    [REQUIRE, SQL_RAW, FOCUS],
  ),
  syntax(['**/*.cjs'], [DEFAULT_EXPORT, SQL_RAW, FOCUS]),
  syntax(['**/*.config.cjs', 'apps/mobile/app.config.ts'], [SQL_RAW, FOCUS]),
  syntax(['packages/db/src/sql/**', 'packages/db/migrations/**'], [DEFAULT_EXPORT, REQUIRE, FOCUS]),
];
