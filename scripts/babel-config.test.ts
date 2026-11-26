import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './lib/repo-root.ts';

// apps/mobile/babel.config.cjs writes each value imported by name from the generated API client's
// entry as a request of its own, which metro.config.cjs resolves to the file that defines it.

type Babel = {
  transformSync: (
    code: string,
    options: Record<string, unknown>,
  ) => { code?: string | null } | null;
};

const APP = join(repoRoot(), 'apps/mobile');
const fromApp = createRequire(join(APP, 'package.json'));
const fromPreset = createRequire(fromApp.resolve('babel-preset-expo'));
const babel = fromPreset('@babel/core') as Babel;

function transform(code: string): string {
  const result = babel.transformSync(code, {
    filename: join(APP, 'src/lib/sample.ts'),
    cwd: APP,
    root: APP,
    configFile: join(APP, 'babel.config.cjs'),
    caller: { name: 'metro', bundler: 'metro', platform: 'web' },
  });
  return result?.code ?? '';
}

/** The modules the output requires, without Babel's own runtime helpers. */
function requests(code: string): string[] {
  return [...code.matchAll(/require\("([^"]+)"\)/g)]
    .map((match) => match[1] ?? '')
    .filter((request) => !request.startsWith('@babel/runtime/'));
}

describe('babel.config.cjs', () => {
  it('gives each value imported from the client entry a request of its own', () => {
    const code = transform(
      [
        "import { useGetReadyz, createClientError as report } from '@citizenrun/shared/api';",
        'export const used = [useGetReadyz, report];',
      ].join('\n'),
    );
    expect(requests(code)).toEqual([
      '@citizenrun/shared/api/useGetReadyz',
      '@citizenrun/shared/api/createClientError',
    ]);
  });

  it('drops type imports and keeps namespace imports on the entry', () => {
    const code = transform(
      [
        "import type { ReadyzResponse } from '@citizenrun/shared/api';",
        "import { type HealthzResponse, getMe } from '@citizenrun/shared/api';",
        "import * as api from '@citizenrun/shared/api';",
        'export const used = (a: ReadyzResponse, b: HealthzResponse) => [a, b, getMe, api];',
      ].join('\n'),
    );
    expect(requests(code)).toEqual(['@citizenrun/shared/api/getMe', '@citizenrun/shared/api']);
  });

  it('leaves other imports alone', () => {
    const code = transform(
      [
        "import { ApiError } from '@citizenrun/shared';",
        "import { session } from '@/platform/session';",
        'export const used = [ApiError, session];',
      ].join('\n'),
    );
    expect(requests(code)).toEqual(['@citizenrun/shared', '@/platform/session']);
  });
});
