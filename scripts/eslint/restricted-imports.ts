import { readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import type { ESLint, Linter, Rule } from 'eslint';
import tseslint from 'typescript-eslint';
import { field } from './ast.ts';
import { repoRoot } from '../lib/repo-root.ts';

export type RestrictedRow = {
  id: string;
  files: string[];
  ignores?: string[];
  paths?: { name: string; importNames?: string[]; message: string }[];
  patterns?: { group?: string[]; regex?: string; message: string }[];
  globals?: { name: string; message: string }[];
};

/** A path that stays at one module or one of its subpaths: `^name(/|$)`. */
const mod = (...names: string[]): string =>
  `^(?:${names.map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})(?:/|$)`;

const PACKAGE_ROOTS = [
  'apps/api',
  'apps/mobile',
  'apps/worker',
  'packages/shared',
  'packages/db',
  'packages/cards',
  'packages/rules',
  'packages/ai',
  'pipeline',
] as const;
const LEAVE_DEPTHS = 12;

/** The Node built-ins written without `node:` (`fs`, `path`); the `node:` form has rows of its own. */
const BARE_BUILTINS = builtinModules.filter(
  (name) => !name.startsWith('node:') && !name.includes('/'),
);

const OTHER_WORKSPACE = '^@citizenrun/(?!shared(?:/|$))';
const PLATFORM_BOUND = [
  'expo-secure-store',
  'expo-notifications',
  'expo-location',
  'expo-calendar',
  'expo-image-picker',
  'expo-image-manipulator',
  'react-native-compressor',
  'expo-apple-authentication',
  'expo-age-range',
  'expo-sharing',
  'expo-print',
  'expo-file-system',
  'expo-haptics',
  'expo-network',
  'expo-web-browser',
  'expo-crypto',
  'expo-video',
  '@maplibre/maplibre-react-native',
  'maplibre-gl',
  '@cantoo/pdf-lib',
];
const NODE_FILES_OF = (pkg: string): string[] => [`${pkg}/scripts/**`, `${pkg}/*.config.ts`];
const TEST_CODE = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.int.test.ts',
  '**/*.media.test.ts',
  '**/testing/**',
  'apps/mobile/src/test/**',
  'apps/mobile/e2e/**',
  'scripts/**',
];

/** The restricted-import table (D-451, INV-14), one entry per row and per "outside" clause. */
export const ROWS: readonly RestrictedRow[] = [
  {
    id: 'shared',
    files: ['packages/shared/**'],
    patterns: [
      { regex: '^@citizenrun/', message: '@citizenrun/shared imports no other workspace package.' },
      {
        regex: mod('react-native', 'hono', 'drizzle-orm', 'pg', 'pg-boss'),
        message: '@citizenrun/shared runs everywhere: no React Native, Hono or database client.',
      },
      {
        regex: '^@hono/',
        message: '@citizenrun/shared runs everywhere: no React Native, Hono or database client.',
      },
      { regex: '^expo', message: '@citizenrun/shared runs everywhere: no Expo module.' },
    ],
  },
  {
    id: 'shared-aws',
    files: ['packages/shared/**'],
    ignores: ['packages/shared/src/storage/**', ...NODE_FILES_OF('packages/shared')],
    patterns: [
      {
        regex: '^@aws-sdk/',
        message: 'Only the ./storage entry of @citizenrun/shared uses the AWS SDK.',
      },
    ],
    globals: [
      {
        name: 'process',
        message: 'The root entry of @citizenrun/shared runs in browsers too: no process.',
      },
    ],
  },
  {
    id: 'shared-node',
    files: ['packages/shared/**'],
    ignores: [
      'packages/shared/src/storage/**',
      'packages/shared/src/crypto/**',
      ...NODE_FILES_OF('packages/shared'),
    ],
    patterns: [
      {
        regex: '^node:',
        message: 'The root entry of @citizenrun/shared runs in browsers too: no node: module.',
      },
      {
        regex: mod(...BARE_BUILTINS),
        message: 'The root entry of @citizenrun/shared runs in browsers too: no Node built-in.',
      },
    ],
  },
  {
    id: 'shared-crypto',
    files: ['packages/shared/src/crypto/**'],
    patterns: [
      {
        regex: '^node:(?!crypto$)',
        message: 'The ./crypto entry uses node:crypto and no other node: module.',
      },
      {
        regex: mod(...BARE_BUILTINS.filter((name) => name !== 'crypto')),
        message: 'The ./crypto entry uses node:crypto and no other Node built-in.',
      },
    ],
  },
  {
    id: 'shared-forms',
    files: ['packages/shared/**'],
    ignores: ['packages/shared/src/forms/**'],
    patterns: [
      {
        regex: mod('@cantoo/pdf-lib', '@pdf-lib/fontkit'),
        message: 'Only the ./forms entry loads the PDF library.',
      },
    ],
  },
  {
    id: 'shared-calendar',
    files: ['packages/shared/**'],
    ignores: ['packages/shared/src/calendar/**'],
    patterns: [
      { regex: mod('ical-generator'), message: 'Only the ./calendar entry writes calendar files.' },
    ],
  },
  {
    id: 'cards',
    files: ['packages/cards/**'],
    patterns: [
      {
        regex: OTHER_WORKSPACE,
        message: '@citizenrun/cards imports only @citizenrun/shared from the workspace.',
      },
      {
        regex: mod('react-native'),
        message: '@citizenrun/cards has no platform code: no React Native.',
      },
      {
        regex: '^react-native-(?!svg(?:/|$))',
        message: '@citizenrun/cards has no platform code: no React Native library.',
      },
      {
        regex: '^(?:expo|@expo/)',
        message: '@citizenrun/cards has no platform code: no Expo module.',
      },
      { regex: '^@shopify/', message: '@citizenrun/cards has no platform code.' },
      {
        regex: mod('i18next', 'react-i18next'),
        message: 'Card text functions take t as an argument.',
      },
    ],
  },
  {
    id: 'cards-svg',
    files: ['packages/cards/**'],
    ignores: ['packages/cards/src/primitives/native.ts'],
    patterns: [
      {
        regex: mod('react-native-svg'),
        message: 'Only the native primitives file draws with react-native-svg.',
      },
    ],
  },
  {
    id: 'cards-node',
    files: ['packages/cards/**'],
    ignores: ['packages/cards/src/server/**', ...NODE_FILES_OF('packages/cards')],
    patterns: [
      {
        regex: mod('react-dom', '@resvg/resvg-js'),
        message: 'Only the server folder of @citizenrun/cards renders to a document or a PNG.',
      },
      {
        regex: '^node:',
        message: 'Card code runs in the app too: no node: module outside the server folder.',
      },
    ],
  },
  {
    id: 'rules',
    files: ['packages/rules/**'],
    patterns: [
      {
        regex: OTHER_WORKSPACE,
        message: '@citizenrun/rules imports only @citizenrun/shared from the workspace.',
      },
      {
        regex: '^node:',
        message: '@citizenrun/rules is pure functions and data: no node: module.',
      },
    ],
  },
  {
    id: 'db',
    files: ['packages/db/**'],
    patterns: [
      {
        regex: OTHER_WORKSPACE,
        message: '@citizenrun/db imports only @citizenrun/shared from the workspace.',
      },
    ],
  },
  {
    id: 'ai',
    files: ['packages/ai/**'],
    patterns: [
      {
        regex: OTHER_WORKSPACE,
        message: '@citizenrun/ai imports only @citizenrun/shared from the workspace.',
      },
    ],
  },
  {
    id: 'mobile',
    files: ['apps/mobile/**'],
    patterns: [
      {
        regex: mod(
          '@citizenrun/db',
          '@citizenrun/rules',
          '@citizenrun/ai',
          '@citizenrun/pipeline',
          '@citizenrun/api',
          '@citizenrun/worker',
          '@citizenrun/shared/storage',
        ),
        message:
          'The app imports only @citizenrun/shared (without ./storage) and @citizenrun/cards.',
      },
      {
        regex: '^@aws-sdk/',
        message: 'The app never holds storage credentials: no AWS SDK.',
      },
      {
        regex: mod('pg', 'drizzle-orm', 'hono'),
        message: 'The app has no database client and no server.',
      },
      {
        regex: mod('@expo/vector-icons', 'expo-av'),
        message: 'These modules are not used (D-160, D-161).',
      },
      {
        regex: '/legacy(?:/|$)',
        message: 'Use the current API of a module, not its legacy entry.',
      },
      { regex: '^react-native/Libraries/', message: 'Do not import React Native internals.' },
    ],
  },
  {
    id: 'mobile-node',
    files: ['apps/mobile/**'],
    ignores: ['apps/mobile/e2e/**', 'apps/mobile/*.config.*'],
    patterns: [
      { regex: '^node:', message: 'App code runs on phones and in browsers: no node: module.' },
    ],
  },
  {
    id: 'mobile-platform-bound',
    files: ['apps/mobile/app/**', 'apps/mobile/src/**'],
    ignores: ['apps/mobile/src/platform/**'],
    patterns: [
      {
        regex: mod(...PLATFORM_BOUND),
        message:
          'This module is platform-bound: use it through its module in apps/mobile/src/platform.',
      },
    ],
  },
  {
    id: 'mobile-controls',
    files: ['apps/mobile/app/**', 'apps/mobile/src/features/**'],
    paths: [
      {
        name: 'react-native',
        importNames: [
          'Pressable',
          'TouchableOpacity',
          'TouchableHighlight',
          'TouchableWithoutFeedback',
          'Dimensions',
          'useWindowDimensions',
          'Appearance',
          'useColorScheme',
          'PixelRatio',
        ],
        message: 'Use the design-system controls, useBreakpoint() and the theme instead.',
      },
    ],
  },
  {
    id: 'mobile-ui-components',
    files: ['apps/mobile/app/**', 'apps/mobile/src/**'],
    ignores: ['apps/mobile/src/ui/**'],
    paths: [
      {
        name: 'react-native',
        importNames: [
          'Text',
          'TextInput',
          'Switch',
          'ActivityIndicator',
          'RefreshControl',
          'Modal',
          'Image',
          'Alert',
        ],
        message: 'Use the component of the same purpose in src/ui.',
      },
    ],
    patterns: [
      {
        regex: mod('expo-image', '@shopify/flash-list'),
        message: 'Use the component of the same purpose in src/ui.',
      },
    ],
  },
  {
    id: 'mobile-visual',
    files: [
      'apps/mobile/src/features/*/components/**',
      'apps/mobile/src/features/*/screens/**',
      'apps/mobile/src/ui/**',
    ],
    patterns: [
      {
        regex: '(?:^|/)data(?:/|$)',
        message: 'Visual code gets its data from the view-model, not a data folder.',
      },
      {
        regex: mod('@citizenrun/shared/api', '@tanstack/react-query'),
        message: 'Visual code gets its data from the view-model, not the API client.',
      },
      {
        regex: '^@/platform/(?!(?:haptics|map|video)(?:/|$))',
        message: 'Visual code uses only the haptics, map and video platform modules.',
      },
    ],
    globals: [
      {
        name: 'fetch',
        message: 'Visual code gets its data from the view-model; it never fetches.',
      },
    ],
  },
  {
    id: 'mobile-ui',
    files: ['apps/mobile/src/ui/**'],
    patterns: [{ regex: mod('@/features'), message: 'The design system imports no feature.' }],
  },
  {
    id: 'mobile-lib',
    files: ['apps/mobile/src/lib/**'],
    patterns: [
      {
        regex: mod('@/features', '@/ui'),
        message: 'src/lib imports no feature and nothing from src/ui.',
      },
    ],
  },
  {
    id: 'api',
    files: ['apps/api/**'],
    patterns: [
      {
        regex: mod(
          '@citizenrun/ai',
          '@citizenrun/pipeline',
          '@citizenrun/worker',
          '@citizenrun/mobile',
        ),
        message:
          'The API imports only shared, db, cards and rules from the workspace; it makes no AI call.',
      },
      {
        regex: mod('@citizenrun/shared/api'),
        message: 'Server code imports the schemas, never the generated client.',
      },
      { regex: mod('@anthropic-ai/sdk'), message: 'Only @citizenrun/ai calls the AI provider.' },
    ],
  },
  {
    id: 'worker',
    files: ['apps/worker/**'],
    patterns: [
      {
        regex: mod('@citizenrun/pipeline', '@citizenrun/api', '@citizenrun/mobile'),
        message: 'The worker imports only shared, db, cards, rules and ai from the workspace.',
      },
      {
        regex: mod('@citizenrun/shared/api'),
        message: 'Server code imports the schemas, never the generated client.',
      },
      { regex: mod('@anthropic-ai/sdk'), message: 'Only @citizenrun/ai calls the AI provider.' },
      {
        regex: mod('fluent-ffmpeg', 'ffmpeg-static', 'ffprobe-static'),
        message: 'ffmpeg runs from the image with spawn (D-065).',
      },
    ],
  },
  {
    id: 'pipeline',
    files: ['pipeline/**'],
    patterns: [
      {
        regex: mod(
          '@citizenrun/db',
          '@citizenrun/cards',
          '@citizenrun/api',
          '@citizenrun/worker',
          '@citizenrun/mobile',
        ),
        message: 'The pipeline never touches the app database or the apps (INV-14).',
      },
      {
        regex: mod('pg', 'drizzle-orm', 'pg-boss'),
        message: 'The pipeline never connects to the app database (INV-14).',
      },
      { regex: mod('@anthropic-ai/sdk'), message: 'Only @citizenrun/ai calls the AI provider.' },
    ],
  },
  {
    id: 'pipeline-fetch',
    files: ['pipeline/**'],
    ignores: ['pipeline/lib/fetch/**', 'pipeline/extract/second-pass-local.ts'],
    globals: [
      {
        name: 'fetch',
        message: 'The pipeline fetches only through its fetcher, which follows the crawl policy.',
      },
    ],
  },
  {
    id: 'server-fetch',
    files: ['apps/api/src/**', 'apps/worker/src/**'],
    ignores: ['apps/api/src/lib/outbound-fetch.ts', 'apps/worker/src/lib/outbound-fetch.ts'],
    globals: [
      {
        name: 'fetch',
        message: 'Outbound requests go through outboundFetch, which holds the host allow-list.',
      },
    ],
  },
  {
    id: 'crypto',
    files: ['**/*'],
    ignores: ['apps/api/**', 'apps/worker/**', 'scripts/**'],
    patterns: [
      {
        regex: mod('@citizenrun/shared/crypto'),
        message: 'Only the API and the worker use ./crypto.',
      },
    ],
  },
  {
    id: 'calendar',
    files: ['**/*'],
    ignores: ['apps/api/**', 'scripts/**'],
    patterns: [
      { regex: mod('@citizenrun/shared/calendar'), message: 'Only the API writes calendar files.' },
    ],
  },
  {
    id: 'forms',
    files: ['**/*'],
    ignores: ['apps/mobile/src/platform/**', 'pipeline/**/*.test.ts'],
    patterns: [
      {
        regex: mod('@citizenrun/shared/forms'),
        message: 'Only the pdf platform module fills forms.',
      },
    ],
  },
  {
    id: 'testing',
    files: ['**/*'],
    ignores: TEST_CODE,
    patterns: [
      {
        regex: mod('@citizenrun/shared/testing', '@citizenrun/db/testing'),
        message: 'Test helpers are imported only by tests and test harness code.',
      },
    ],
  },
  {
    id: 'deep-src',
    files: ['**/*'],
    patterns: [
      {
        regex: '^@citizenrun/[^/]+/src(?:/|$)',
        message:
          'Import another package by its name and a declared entry point, never a path into its src.',
      },
    ],
  },
];

/**
 * One row per feature folder: a feature reaches another only through its index
 * (`@/features/<b>`), never a deep path. The feature list is read from disk.
 */
export function featureRows(features: readonly string[]): RestrictedRow[] {
  return features.map((feature) => ({
    id: `feature-${feature}`,
    files: [`apps/mobile/src/features/${feature}/**`],
    patterns: [
      {
        regex: `^@/features/(?!${feature}/)[^/]+/`,
        message: 'Import another feature only through its index: @/features/<name>.',
      },
    ],
  }));
}

function featureFolders(): string[] {
  try {
    return readdirSync(join(repoRoot(), 'apps/mobile/src/features'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

const LEAVE_MESSAGE =
  'Do not reach outside the package with a relative path; import another package by its name.';

/** One `.` segment, as a path resolver reads it: any run of slashes ends a segment. */
const DOT_SEGMENT = '\\.(?:/+|$)';
/** One `..` segment followed by any `.` segments. */
const UP_SEGMENT = `\\.\\.(?:/+|$)(?:${DOT_SEGMENT})*`;

/** A path that climbs `levels` folders or more before it names one (`../..`, `./../`, `..//../`). */
const climbs = (levels: number): string =>
  `^(?:${DOT_SEGMENT})*(?:${UP_SEGMENT}){${String(levels)},}`;

/** A path with a `..` after a folder name (`../a/../../`): it can leave the package unseen by `climbs`. */
const CLIMB_AFTER_NAME = '^(?:\\.\\.?/+)*(?!\\.\\.?(?:/|$))[^/]+/(?:.*/)?\\.\\.(?:/|$)';

function isRule(value: unknown): value is Rule.RuleModule {
  return (
    typeof value === 'object' && value !== null && typeof field(value, 'create') === 'function'
  );
}

/** typescript-eslint's no-restricted-imports, which also restricts type-only imports. */
function restrictedImportsRule(): Rule.RuleModule {
  const rules = field(tseslint.plugin, 'rules');
  const rule =
    typeof rules === 'object' && rules !== null ? field(rules, 'no-restricted-imports') : null;
  if (!isRule(rule)) {
    throw new Error('typescript-eslint provides no no-restricted-imports rule');
  }
  return rule;
}

const RULE = restrictedImportsRule();
const plugins = new Map<string, ESLint.Plugin>();

/** One plugin per namespace, so a file several rows match is checked against each of them. */
function namespace(id: string): { name: string; plugin: ESLint.Plugin } {
  const name = `ri-${id}`;
  let plugin = plugins.get(name);
  if (plugin === undefined) {
    plugin = { meta: { name }, rules: { 'no-restricted-imports': RULE } };
    plugins.set(name, plugin);
  }
  return { name, plugin };
}

/** The plugin of one row's namespace, `ri-<id>`. */
export function restrictedNamespacePlugin(id: string): ESLint.Plugin {
  return namespace(id).plugin;
}

function rowConfig(row: RestrictedRow, namespaceId: string = row.id): Linter.Config {
  const config: Linter.Config = {
    name: `citizenrun/restricted-imports/${row.id}`,
    files: row.files,
    ...(row.ignores === undefined ? {} : { ignores: row.ignores }),
    rules: {},
  };
  const rules: Linter.RulesRecord = {};
  if (row.paths !== undefined || row.patterns !== undefined) {
    const { name, plugin } = namespace(namespaceId);
    config.plugins = { [name]: plugin };
    rules[`${name}/no-restricted-imports`] = [
      'error',
      {
        ...(row.paths === undefined ? {} : { paths: row.paths }),
        ...(row.patterns === undefined ? {} : { patterns: row.patterns }),
      },
    ];
  }
  if (row.globals !== undefined) {
    rules['no-restricted-globals'] = ['error', ...row.globals];
  }
  config.rules = rules;
  return config;
}

/** The leave-the-package entries: one per package root and folder depth, in one namespace. */
export function leaveRows(): RestrictedRow[] {
  const rows: RestrictedRow[] = [];
  for (const root of PACKAGE_ROOTS) {
    for (let depth = 0; depth <= LEAVE_DEPTHS; depth += 1) {
      rows.push({
        id: `leave/${root}/${String(depth)}`,
        files: [`${root}/${'*/'.repeat(depth)}*.{ts,tsx,mts,cts}`],
        ignores: [`${root}/*.config.ts`, `${root}/scripts/**`],
        patterns: [
          { regex: climbs(depth + 1), message: LEAVE_MESSAGE },
          {
            regex: CLIMB_AFTER_NAME,
            message: 'Write a relative path with no `..` after a folder name. ' + LEAVE_MESSAGE,
          },
        ],
      });
    }
  }
  return rows;
}

/** The flat-config entries of the restricted-import table. */
export function buildRestrictedImports(features: readonly string[]): Linter.Config[] {
  return [
    ...[...ROWS, ...featureRows(features)].map((row) => rowConfig(row)),
    ...leaveRows().map((row) => rowConfig(row, 'leave')),
  ];
}

export const restrictedImports: Linter.Config[] = buildRestrictedImports(featureFolders());
