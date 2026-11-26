import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { repoRoot } from './lib/repo-root.ts';

// apps/mobile/metro.config.cjs resolves the `locales` re-export of zod's entry modules to a module
// that exports English alone, which keeps every zod locale out of the web bundle (D-164). It also
// resolves each `@citizenrun/shared/api/<name>` request that babel.config.cjs writes to the one
// generated file that defines the name, so the web bundle carries only the operations it calls.

type Resolution = { type: string; filePath?: string };
type ResolveContext = {
  originModulePath: string;
  resolveRequest: (
    context: ResolveContext,
    moduleName: string,
    platform: string | null,
  ) => Resolution;
};
type Resolve = (context: ResolveContext, moduleName: string, platform: string | null) => Resolution;

const APP = join(repoRoot(), 'apps/mobile');
const STUB = join(APP, 'src/lib/zod-locales.ts');
const LOCALES_REQUEST = '../locales/index.js';
const fromApp = createRequire(join(APP, 'package.json'));
const ZOD = dirname(fromApp.resolve('zod/package.json'));
const ZOD_ENTRIES = ['v4/core/index.js', 'v4/classic/external.js'];
const METRO_ANSWER: Resolution = { type: 'sourceFile', filePath: '/resolved/by/metro.js' };
const API = join(repoRoot(), 'packages/shared/src/api');
const API_ENTRY = '@citizenrun/shared/api';
const API_INDEX: Resolution = { type: 'sourceFile', filePath: join(API, 'index.ts') };

function resolveRequest(): Resolve {
  const config = fromApp('./metro.config.cjs') as { resolver: { resolveRequest: Resolve } };
  return config.resolver.resolveRequest;
}

function contextFrom(originModulePath: string): ResolveContext {
  return { originModulePath, resolveRequest: vi.fn(() => METRO_ANSWER) };
}

describe('metro.config.cjs', () => {
  it('resolves the locales import of zod core and zod classic to the English-only module', () => {
    expect(existsSync(STUB)).toBe(true);
    const resolve = resolveRequest();
    for (const entry of ZOD_ENTRIES) {
      const context = contextFrom(join(ZOD, entry));
      expect(resolve(context, LOCALES_REQUEST, 'web')).toEqual({
        type: 'sourceFile',
        filePath: STUB,
      });
      expect(context.resolveRequest).not.toHaveBeenCalled();
    }
  });

  it('leaves every other request to Metro', () => {
    const resolve = resolveRequest();
    const cases: [string, string][] = [
      [join(ZOD, 'v4/core/index.js'), './schemas.js'],
      [join(ZOD, 'v4/classic/schemas.js'), '../locales/en.js'],
      [join(APP, 'src/lib/env.ts'), LOCALES_REQUEST],
      [join(APP, 'node_modules/other/v4/core/index.js'), LOCALES_REQUEST],
    ];
    for (const [origin, request] of cases) {
      const context = contextFrom(origin);
      expect(resolve(context, request, 'ios')).toEqual(METRO_ANSWER);
      expect(context.resolveRequest).toHaveBeenCalledWith(context, request, 'ios');
    }
  });

  it('matches the import the installed zod makes', () => {
    for (const entry of ZOD_ENTRIES) {
      expect(readFileSync(join(ZOD, entry), 'utf8')).toContain(
        `export * as locales from "${LOCALES_REQUEST}";`,
      );
    }
  });

  it('resolves a name of the generated client to the file that defines it', () => {
    const resolve = resolveRequest();
    const cases: [string, string][] = [
      ['useGetReadyz', 'web/web.ts'],
      ['createClientError', 'safety/safety.ts'],
      ['getMe', 'me/me.ts'],
    ];
    for (const [name, file] of cases) {
      const context = contextFrom(join(APP, 'src/lib/client-errors.ts'));
      vi.mocked(context.resolveRequest).mockReturnValue(API_INDEX);
      expect(resolve(context, `${API_ENTRY}/${name}`, 'web')).toEqual({
        type: 'sourceFile',
        filePath: join(API, file),
      });
      expect(context.resolveRequest).toHaveBeenCalledWith(context, API_ENTRY, 'web');
    }
  });

  it('resolves a name no generated file defines to the entry', () => {
    const resolve = resolveRequest();
    for (const name of ['NoSuchOperation', 'ReadyzResponse']) {
      const context = contextFrom(join(APP, 'src/lib/client-errors.ts'));
      vi.mocked(context.resolveRequest).mockReturnValue(API_INDEX);
      expect(resolve(context, `${API_ENTRY}/${name}`, 'ios')).toEqual(API_INDEX);
    }
  });

  it('leaves the entry itself to Metro', () => {
    const resolve = resolveRequest();
    const context = contextFrom(join(APP, 'src/lib/client-errors.ts'));
    expect(resolve(context, API_ENTRY, 'web')).toEqual(METRO_ANSWER);
    expect(context.resolveRequest).toHaveBeenCalledWith(context, API_ENTRY, 'web');
  });
});
