import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Metafile } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BANNER,
  NATIVE_EXTERNALS,
  OPTIONAL_EXTERNALS,
  UsageError,
  buildService,
  checkExternals,
  packageNameOf,
  parseBuildArgs,
} from './build-service.ts';

/** A metafile whose one output imports the given paths as externals. */
function metafileImporting(...paths: string[]): Metafile {
  return {
    inputs: {},
    outputs: {
      'dist/out.js': {
        bytes: 1,
        inputs: {},
        imports: paths.map((path) => ({ path, kind: 'import-statement', external: true })),
        exports: [],
      },
    },
  };
}

describe('packageNameOf', () => {
  it('package names from import paths', () => {
    expect(packageNameOf('sharp')).toBe('sharp');
    expect(packageNameOf('@resvg/resvg-js/index.js')).toBe('@resvg/resvg-js');
    expect(packageNameOf('pg-native')).toBe('pg-native');
    expect(packageNameOf('sharp/lib/index.js')).toBe('sharp');
    expect(packageNameOf('@resvg/resvg-js')).toBe('@resvg/resvg-js');
  });
});

describe('checkExternals', () => {
  it('a native external that is not a dependency is a problem', () => {
    const problems = checkExternals(metafileImporting('sharp'), new Set(), false);
    expect(problems).toEqual(['sharp is imported but is not a dependency of the package']);
  });

  it('accepts a native external that is a direct dependency', () => {
    expect(checkExternals(metafileImporting('sharp'), new Set(['sharp']), false)).toEqual([]);
  });

  it('a native external is a problem with --no-externals', () => {
    const problems = checkExternals(metafileImporting('sharp'), new Set(['sharp']), true);
    expect(problems).toEqual(['sharp is imported but --no-externals was given']);
  });

  it('names a scoped native external by its package name', () => {
    const problems = checkExternals(
      metafileImporting('@resvg/resvg-js/index.js'),
      new Set(),
      false,
    );
    expect(problems).toEqual([
      '@resvg/resvg-js is imported but is not a dependency of the package',
    ]);
  });

  it('optional externals are never a problem', () => {
    expect(checkExternals(metafileImporting(...OPTIONAL_EXTERNALS), new Set(), true)).toEqual([]);
    expect(checkExternals(metafileImporting('pg-native'), new Set(), false)).toEqual([]);
  });

  it('ignores imports that are inside the bundle and built-in modules', () => {
    const metafile = metafileImporting('node:path');
    const output = metafile.outputs['dist/out.js'];
    output?.imports.push({ path: 'sharp', kind: 'import-statement' });
    expect(checkExternals(metafile, new Set(), true)).toEqual([]);
  });

  it('reports each native external once', () => {
    const problems = checkExternals(
      metafileImporting('sharp', 'sharp/lib/x.js', 'onnxruntime-node'),
      new Set(),
      true,
    );
    expect(problems).toHaveLength(2);
    expect(NATIVE_EXTERNALS).toContain('onnxruntime-node');
  });
});

describe('parseBuildArgs', () => {
  it('arguments parse', () => {
    expect(parseBuildArgs(['src/server.ts', 'dist/server.js'])).toEqual({
      entry: 'src/server.ts',
      outfile: 'dist/server.js',
      noExternals: false,
    });
    expect(parseBuildArgs(['src/server.ts', 'dist/server.js', '--no-externals'])).toEqual({
      entry: 'src/server.ts',
      outfile: 'dist/server.js',
      noExternals: true,
    });
  });

  it('treats a third positional argument as a usage error', () => {
    expect(() => parseBuildArgs(['src/server.ts', 'dist/server.js', 'extra.js'])).toThrow(
      UsageError,
    );
  });

  it('treats a missing outfile or an unknown option as a usage error', () => {
    expect(() => parseBuildArgs(['src/server.ts'])).toThrow(UsageError);
    expect(() => parseBuildArgs(['src/server.ts', 'dist/server.js', '--minify'])).toThrow(
      UsageError,
    );
  });
});

describe('buildService', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'build-service-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a bundle of a small entry starts with the banner and keeps no import of a workspace package', async () => {
    writeFileSync(join(dir, 'package.json'), '{ "name": "fixture", "type": "module" }\n');
    writeFileSync(join(dir, 'b.ts'), "export const joined = (a: string): string => a + '/b';\n");
    writeFileSync(
      join(dir, 'a.ts'),
      "import { join } from 'node:path';\nimport { joined } from './b.ts';\nconsole.log(join(joined('x'), 'y'));\n",
    );
    await buildService({ entry: 'a.ts', outfile: 'dist/a.js', noExternals: true }, dir);

    const output = readFileSync(join(dir, 'dist/a.js'), 'utf8');
    expect(output.startsWith(BANNER)).toBe(true);
    expect(output).not.toMatch(/import[^;]*["']\.\/b(\.ts)?["']/);
    expect(output).toContain('a + "/b"');
    expect(existsSync(join(dir, 'dist/a.js.meta.json'))).toBe(true);
    expect(existsSync(join(dir, 'dist/a.js.map'))).toBe(true);
    const meta: unknown = JSON.parse(readFileSync(join(dir, 'dist/a.js.meta.json'), 'utf8'));
    expect(meta).toHaveProperty(['inputs', 'b.ts']);
  });
});
