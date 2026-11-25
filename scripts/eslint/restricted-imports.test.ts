import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { field } from './ast.ts';
import { buildRestrictedImports, restrictedImports, ROWS } from './restricted-imports.ts';
import { repoRoot } from '../lib/repo-root.ts';

function isParser(value: unknown): value is Linter.Parser {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof field(value, 'parseForESLint') === 'function'
  );
}

const parser: unknown = tseslint.parser;
if (!isParser(parser)) {
  throw new Error('typescript-eslint provides no parser');
}

const linter = new Linter({ cwd: repoRoot() });

/** The rule ids that report on `code` in `filename`. */
function reports(configs: Linter.Config[], filename: string, code: string): string[] {
  const messages = linter.verify(
    code,
    [{ files: ['**/*.{ts,tsx,mts,cts}'], languageOptions: { parser } }, ...configs],
    { filename },
  );
  const fatal = messages.find((message) => message.fatal === true);
  if (fatal !== undefined) {
    throw new Error(fatal.message);
  }
  return messages.map((message) => message.ruleId ?? 'none');
}

type Case = { row: string; file: string; code: string; fails: boolean };

const imports = (row: string): string => `ri-${row}/no-restricted-imports`;
const GLOBALS = 'no-restricted-globals';

/** One failing and one passing case per row; `row` names the row whose report is expected. */
const CASES: Case[] = [
  { row: 'shared', file: 'packages/shared/src/ids.ts', code: "import 'hono';", fails: true },
  {
    row: 'shared',
    file: 'packages/shared/src/ids.ts',
    code: "import { z } from '@hono/zod-openapi';",
    fails: true,
  },
  {
    row: 'shared',
    file: 'packages/shared/src/ids.ts',
    code: "import { z } from 'zod';",
    fails: false,
  },
  {
    row: 'shared-aws',
    file: 'packages/shared/src/ids.ts',
    code: "import '@aws-sdk/client-s3';",
    fails: true,
  },
  {
    row: 'shared-aws',
    file: 'packages/shared/src/storage/client.ts',
    code: "import '@aws-sdk/client-s3';",
    fails: false,
  },
  {
    row: 'shared-node',
    file: 'packages/shared/src/ids.ts',
    code: "import { readFile } from 'node:fs';",
    fails: true,
  },
  {
    row: 'shared-node',
    file: 'packages/shared/src/ids.ts',
    code: "import { readFile } from 'fs';",
    fails: true,
  },
  {
    row: 'shared-node',
    file: 'packages/shared/src/ids.ts',
    code: "import { readFile } from 'fs/promises';",
    fails: true,
  },
  { row: 'shared-node', file: 'packages/shared/src/ids.ts', code: "import 'path';", fails: true },
  {
    row: 'shared-node',
    file: 'packages/shared/src/ids.ts',
    code: "import { createHash } from 'crypto';",
    fails: true,
  },
  {
    row: 'shared-node',
    file: 'packages/shared/src/storage/client.ts',
    code: "import { readFile } from 'fs';",
    fails: false,
  },
  {
    row: 'shared-node',
    file: 'packages/shared/src/storage/client.ts',
    code: "import { readFile } from 'node:fs';",
    fails: false,
  },
  {
    row: 'shared-node',
    file: 'packages/shared/scripts/write-api-index.ts',
    code: "import { readFile } from 'node:fs';",
    fails: false,
  },
  {
    row: 'shared-crypto',
    file: 'packages/shared/src/crypto/keys.ts',
    code: "import 'node:fs';",
    fails: true,
  },
  {
    row: 'shared-crypto',
    file: 'packages/shared/src/crypto/keys.ts',
    code: "import 'fs';",
    fails: true,
  },
  {
    row: 'shared-crypto',
    file: 'packages/shared/src/crypto/keys.ts',
    code: "import 'crypto';",
    fails: false,
  },
  {
    row: 'shared-crypto',
    file: 'packages/shared/src/crypto/keys.ts',
    code: "import 'node:crypto';",
    fails: false,
  },
  {
    row: 'shared-forms',
    file: 'packages/shared/src/ids.ts',
    code: "import '@cantoo/pdf-lib';",
    fails: true,
  },
  {
    row: 'shared-forms',
    file: 'packages/shared/src/forms/fill.ts',
    code: "import '@cantoo/pdf-lib';",
    fails: false,
  },
  {
    row: 'shared-calendar',
    file: 'packages/shared/src/ids.ts',
    code: "import 'ical-generator';",
    fails: true,
  },
  {
    row: 'shared-calendar',
    file: 'packages/shared/src/calendar/feed.ts',
    code: "import 'ical-generator';",
    fails: false,
  },
  { row: 'cards', file: 'packages/cards/src/x.ts', code: "import 'react-native';", fails: true },
  {
    row: 'cards',
    file: 'packages/cards/src/x.ts',
    code: "import '@citizenrun/shared';",
    fails: false,
  },
  { row: 'cards', file: 'packages/cards/src/x.ts', code: "import '@citizenrun/db';", fails: true },
  {
    row: 'cards',
    file: 'packages/cards/src/templates/x.tsx',
    code: "import { Rect } from '@citizenrun/cards/primitives';\nexport { Rect };",
    fails: false,
  },
  {
    row: 'cards',
    file: 'packages/cards/src/templates/x.test.tsx',
    code: "import type { RectProps } from '@citizenrun/cards/primitives';\nexport type P = RectProps;",
    fails: false,
  },
  {
    row: 'cards',
    file: 'packages/cards/src/templates/x.tsx',
    code: "import '@citizenrun/cards';",
    fails: true,
  },
  {
    row: 'cards',
    file: 'packages/cards/src/templates/x.tsx',
    code: "import '@citizenrun/cards/server';",
    fails: true,
  },
  {
    row: 'cards',
    file: 'packages/cards/src/templates/x.tsx',
    code: "import '@citizenrun/cards/primitives/native';",
    fails: true,
  },
  {
    row: 'cards',
    file: 'packages/cards/src/templates/x.tsx',
    code: "import '@citizenrun/cards/primitives-extra';",
    fails: true,
  },
  {
    row: 'cards-svg',
    file: 'packages/cards/src/x.ts',
    code: "import 'react-native-svg';",
    fails: true,
  },
  {
    row: 'cards-svg',
    file: 'packages/cards/src/primitives/native.ts',
    code: "import 'react-native-svg';",
    fails: false,
  },
  {
    row: 'cards-node',
    file: 'packages/cards/src/templates/x.ts',
    code: "import 'node:fs';",
    fails: true,
  },
  {
    row: 'cards-node',
    file: 'packages/cards/src/templates/x.ts',
    code: "import { readFile } from 'fs';",
    fails: true,
  },
  {
    row: 'cards-node',
    file: 'packages/cards/src/server/render-png.ts',
    code: "import 'node:fs';",
    fails: false,
  },
  {
    row: 'cards-node',
    file: 'packages/cards/src/server/render-png.ts',
    code: "import 'fs';",
    fails: false,
  },
  { row: 'rules', file: 'packages/rules/src/x.ts', code: "import 'node:fs';", fails: true },
  { row: 'rules', file: 'packages/rules/src/x.ts', code: "import 'path';", fails: true },
  {
    row: 'rules',
    file: 'packages/rules/src/x.ts',
    code: "import '@citizenrun/shared';",
    fails: false,
  },
  { row: 'db', file: 'packages/db/src/x.ts', code: "import '@citizenrun/cards';", fails: true },
  {
    row: 'db',
    file: 'packages/db/src/x.ts',
    code: "import '@citizenrun/cards/primitives';",
    fails: true,
  },
  { row: 'db', file: 'packages/db/src/x.ts', code: "import '@citizenrun/shared';", fails: false },
  { row: 'ai', file: 'packages/ai/src/x.ts', code: "import '@citizenrun/db';", fails: true },
  { row: 'ai', file: 'packages/ai/src/x.ts', code: "import '@citizenrun/shared';", fails: false },
  {
    row: 'mobile',
    file: 'apps/mobile/src/lib/x.ts',
    code: "import '@citizenrun/db';",
    fails: true,
  },
  {
    row: 'mobile',
    file: 'apps/mobile/src/lib/x.ts',
    code: "import '@citizenrun/cards';",
    fails: false,
  },
  {
    row: 'mobile-node',
    file: 'apps/mobile/src/lib/x.ts',
    code: "import 'node:path';",
    fails: true,
  },
  {
    row: 'mobile-node',
    file: 'apps/mobile/src/lib/x.ts',
    code: "import { join } from 'path';",
    fails: true,
  },
  {
    row: 'mobile-node',
    file: 'apps/mobile/src/lib/x.ts',
    code: "import { readFile } from 'fs/promises';",
    fails: true,
  },
  {
    row: 'mobile-node',
    file: 'apps/mobile/e2e/web/hello.spec.ts',
    code: "import 'node:path';",
    fails: false,
  },
  {
    row: 'mobile-node',
    file: 'apps/mobile/e2e/web/hello.spec.ts',
    code: "import 'path';",
    fails: false,
  },
  {
    row: 'mobile-platform-bound',
    file: 'apps/mobile/src/ui/haptic.ts',
    code: "import 'expo-haptics';",
    fails: true,
  },
  {
    row: 'mobile-platform-bound',
    file: 'apps/mobile/src/platform/haptics/index.native.ts',
    code: "import 'expo-haptics';",
    fails: false,
  },
  {
    row: 'mobile-platform-bound',
    file: 'apps/mobile/src/features/x/screens/a.tsx',
    code: "import Head from 'expo-router/head';",
    fails: true,
  },
  {
    row: 'mobile-platform-bound',
    file: 'apps/mobile/src/platform/head/index.web.tsx',
    code: "import Head from 'expo-router/head';",
    fails: false,
  },
  {
    row: 'mobile-platform-bound',
    file: 'apps/mobile/app/_layout.tsx',
    code: "import { Stack } from 'expo-router';",
    fails: false,
  },
  {
    row: 'mobile-controls',
    file: 'apps/mobile/src/features/x/screens/a.tsx',
    code: "import { Pressable } from 'react-native';",
    fails: true,
  },
  {
    row: 'mobile-controls',
    file: 'apps/mobile/src/ui/button.tsx',
    code: "import { Pressable } from 'react-native';",
    fails: false,
  },
  {
    row: 'mobile-ui-components',
    file: 'apps/mobile/src/features/x/components/a.tsx',
    code: "import { Text } from 'react-native';",
    fails: true,
  },
  {
    row: 'mobile-ui-components',
    file: 'apps/mobile/src/ui/text.tsx',
    code: "import { Text } from 'react-native';",
    fails: false,
  },
  {
    row: 'mobile-visual',
    file: 'apps/mobile/src/features/x/screens/a.tsx',
    code: "import { useQuery } from '@tanstack/react-query';",
    fails: true,
  },
  {
    row: 'mobile-visual',
    file: 'apps/mobile/src/features/x/data/a.ts',
    code: "import { useQuery } from '@tanstack/react-query';",
    fails: false,
  },
  {
    row: 'mobile-visual',
    file: 'apps/mobile/src/ui/theme.tsx',
    code: "import { storage } from '@/platform/storage';",
    fails: true,
  },
  {
    row: 'mobile-visual',
    file: 'apps/mobile/src/ui/theme.tsx',
    code: "import { head } from '@/platform/head';",
    fails: false,
  },
  {
    row: 'mobile-visual',
    file: 'apps/mobile/src/features/x/screens/a.tsx',
    code: "import { head } from '@/platform/head';",
    fails: false,
  },
  {
    row: 'mobile-ui',
    file: 'apps/mobile/src/ui/a.ts',
    code: "import '@/features/office';",
    fails: true,
  },
  {
    row: 'mobile-ui',
    file: 'apps/mobile/src/features/x/a.ts',
    code: "import '@/features/office';",
    fails: false,
  },
  {
    row: 'mobile-lib',
    file: 'apps/mobile/src/lib/a.ts',
    code: "import '@/ui/tokens';",
    fails: true,
  },
  {
    row: 'mobile-lib',
    file: 'apps/mobile/src/features/x/a.ts',
    code: "import '@/ui/tokens';",
    fails: false,
  },
  { row: 'api', file: 'apps/api/src/a.ts', code: "import '@citizenrun/ai';", fails: true },
  { row: 'api', file: 'apps/worker/src/a.ts', code: "import '@citizenrun/ai';", fails: false },
  { row: 'worker', file: 'apps/worker/src/a.ts', code: "import 'fluent-ffmpeg';", fails: true },
  {
    row: 'worker',
    file: 'apps/worker/src/a.ts',
    code: "import '@citizenrun/rules';",
    fails: false,
  },
  { row: 'pipeline', file: 'pipeline/x.ts', code: "import 'pg';", fails: true },
  { row: 'pipeline', file: 'packages/db/src/x.ts', code: "import 'pg';", fails: false },
  { row: 'pipeline', file: 'pipeline/x.ts', code: "import '@citizenrun/db';", fails: true },
  {
    row: 'crypto',
    file: 'apps/mobile/src/lib/a.ts',
    code: "import '@citizenrun/shared/crypto';",
    fails: true,
  },
  {
    row: 'crypto',
    file: 'apps/api/src/a.ts',
    code: "import '@citizenrun/shared/crypto';",
    fails: false,
  },
  {
    row: 'calendar',
    file: 'apps/worker/src/a.ts',
    code: "import '@citizenrun/shared/calendar';",
    fails: true,
  },
  {
    row: 'calendar',
    file: 'apps/api/src/a.ts',
    code: "import '@citizenrun/shared/calendar';",
    fails: false,
  },
  {
    row: 'forms',
    file: 'apps/mobile/src/features/x/a.ts',
    code: "import '@citizenrun/shared/forms';",
    fails: true,
  },
  {
    row: 'forms',
    file: 'apps/mobile/src/platform/pdf/index.web.ts',
    code: "import '@citizenrun/shared/forms';",
    fails: false,
  },
  {
    row: 'testing',
    file: 'packages/shared/src/ids.ts',
    code: "import '@citizenrun/shared/testing';",
    fails: true,
  },
  {
    row: 'testing',
    file: 'packages/shared/src/ids.test.ts',
    code: "import '@citizenrun/shared/testing';",
    fails: false,
  },
  {
    row: 'testing',
    file: 'apps/api/src/a.ts',
    code: "import type { Factory } from '@citizenrun/db/testing';\nexport type F = Factory;",
    fails: true,
  },
  {
    row: 'deep-src',
    file: 'scripts/x.ts',
    code: "import '@citizenrun/shared/src/ids';",
    fails: true,
  },
  {
    row: 'deep-src',
    file: 'apps/api/src/a.ts',
    code: "import '@citizenrun/shared/src/ids';",
    fails: true,
  },
  { row: 'deep-src', file: 'scripts/x.ts', code: "import '@citizenrun/shared';", fails: false },
  {
    row: 'leave',
    file: 'packages/shared/src/x.ts',
    code: "import '../../db/src/client.ts';",
    fails: true,
  },
  { row: 'leave', file: 'packages/shared/src/x.ts', code: "import './ids.ts';", fails: false },
  {
    row: 'leave',
    file: 'packages/shared/src/x.ts',
    code: "import './../../db/src/client.ts';",
    fails: true,
  },
  {
    row: 'leave',
    file: 'pipeline/x.ts',
    code: "import './../packages/db/src/client.ts';",
    fails: true,
  },
  {
    row: 'leave',
    file: 'pipeline/lib/x.ts',
    code: "import '../a/../../packages/db/src/client.ts';",
    fails: true,
  },
  {
    row: 'leave',
    file: 'pipeline/lib/x.ts',
    code: "import '.././../packages/db/src/client.ts';",
    fails: true,
  },
  {
    row: 'leave',
    file: 'pipeline/lib/x.ts',
    code: "import '..//../packages/db/src/client.ts';",
    fails: true,
  },
  { row: 'leave', file: 'packages/shared/src/x.ts', code: "import '../..';", fails: true },
  { row: 'leave', file: 'pipeline/lib/x.ts', code: "import '../fetch/x.ts';", fails: false },
  {
    row: 'leave',
    file: 'apps/api/src/routes/a.ts',
    code: "import '../../../../scripts/lib/exec.ts';",
    fails: true,
  },
  { row: 'leave', file: 'apps/api/src/routes/a.ts', code: "import '../lib/x.ts';", fails: false },
  {
    row: 'leave',
    file: 'packages/db/vitest.config.ts',
    code: "import { unitProject } from '../../vitest.shared.ts';\nexport { unitProject };",
    fails: false,
  },
];

const GLOBAL_CASES: { row: string; file: string; fails: boolean }[] = [
  { row: 'shared-aws', file: 'packages/shared/src/ids.ts', fails: true },
  { row: 'shared-aws', file: 'packages/shared/src/storage/client.ts', fails: false },
  { row: 'mobile-visual', file: 'apps/mobile/src/ui/a.ts', fails: true },
  { row: 'mobile-visual', file: 'apps/mobile/src/features/x/data/a.ts', fails: false },
  { row: 'pipeline-fetch', file: 'pipeline/x.ts', fails: true },
  { row: 'pipeline-fetch', file: 'pipeline/lib/fetch/x.ts', fails: false },
  { row: 'server-fetch', file: 'apps/api/src/routes/a.ts', fails: true },
  { row: 'server-fetch', file: 'apps/api/src/lib/outbound-fetch.ts', fails: false },
  { row: 'server-fetch', file: 'apps/worker/src/jobs/a.ts', fails: true },
];

function globalCode(row: string): string {
  return row === 'shared-aws'
    ? 'export const port = process.env.PORT;'
    : "export const response = fetch('x');";
}

describe('restricted imports', () => {
  it.each(CASES)('$row: $code in $file fails is $fails', ({ row, file, code, fails }) => {
    expect(reports(restrictedImports, file, code).includes(imports(row))).toBe(fails);
  });

  it.each(GLOBAL_CASES)(
    '$row: a restricted global in $file fails is $fails',
    ({ row, file, fails }) => {
      expect(reports(restrictedImports, file, globalCode(row)).includes(GLOBALS)).toBe(fails);
    },
  );

  it('has a failing and a passing case for every row', () => {
    const covered = new Set(
      [...CASES, ...GLOBAL_CASES].map((item) => `${item.row}:${String(item.fails)}`),
    );
    for (const row of ROWS) {
      expect(covered).toContain(`${row.id}:true`);
      expect(covered).toContain(`${row.id}:false`);
    }
  });

  it('checks a file against every row that covers it', () => {
    const found = reports(
      restrictedImports,
      'apps/mobile/src/features/x/screens/a.tsx',
      "import { Pressable } from 'react-native';\nimport { client } from '@citizenrun/shared/api';\nexport { Pressable, client };",
    );
    expect(found).toContain(imports('mobile-controls'));
    expect(found).toContain(imports('mobile-visual'));
  });

  it('lets a feature reach another feature only through its index', () => {
    const configs = buildRestrictedImports(['office', 'explore']);
    const file = 'apps/mobile/src/features/office/screens/a.tsx';
    expect(reports(configs, file, "import '@/features/explore/components/map';")).toContain(
      imports('feature-office'),
    );
    expect(reports(configs, file, "import '@/features/explore';")).not.toContain(
      imports('feature-office'),
    );
    expect(reports(configs, file, "import '@/features/office/view-models/a';")).not.toContain(
      imports('feature-office'),
    );
  });
});
