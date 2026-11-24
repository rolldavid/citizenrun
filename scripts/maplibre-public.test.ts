import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The MapLibre worker and stylesheet are committed in the web app's public folder (D-200). Nothing copies
// them at build time, so this guard fails when the installed package and the copies disagree.

const MOBILE = resolve(import.meta.dirname, '..', 'apps', 'mobile');
const PUBLIC = join(MOBILE, 'public');
const PACKAGE = join(MOBILE, 'node_modules', 'maplibre-gl');
const DIST = join(PACKAGE, 'dist');

function installedVersion(): string {
  const manifest = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8')) as {
    version?: unknown;
  };
  if (typeof manifest.version !== 'string') {
    throw new Error('maplibre-gl/package.json has no version');
  }
  return manifest.version;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The `maplibre-gl*` names that do not carry `version` (as `-<version>` before the extension or at the end). */
function staleCopies(names: readonly string[], version: string): string[] {
  const carries = new RegExp(`-${escapeRegExp(version)}(?:\\.(?:mjs|css)|$)`);
  return names.filter((name) => name.startsWith('maplibre-gl') && !carries.test(name));
}

/** The copies of `version`, each with the package file it must equal. */
function expectedCopies(version: string): { copy: string; source: string }[] {
  return [
    { copy: `maplibre-gl-worker-${version}.mjs`, source: 'maplibre-gl-worker.mjs' },
    { copy: `maplibre-gl-${version}.css`, source: 'maplibre-gl.css' },
  ];
}

/** What to do about the copies: names each stale or wrong file and the two copy commands. */
function fixMessage(problem: string, files: readonly string[], version: string): string {
  const commands = expectedCopies(version).map(
    ({ copy, source }) =>
      `cp apps/mobile/node_modules/maplibre-gl/dist/${source} apps/mobile/public/${copy}`,
  );
  return [
    `${problem}: ${files.join(', ')}.`,
    `Copy the two files again from the installed package (maplibre-gl ${version}) and delete every other apps/mobile/public/maplibre-gl* file:`,
    ...commands,
  ].join('\n');
}

describe('the MapLibre copies in the web public folder', () => {
  const version = installedVersion();

  it('the worker copy matches the installed package', () => {
    const { copy, source } = expectedCopies(version)[0] as { copy: string; source: string };
    const path = join(PUBLIC, copy);
    expect(existsSync(path), fixMessage('Missing copy', [copy], version)).toBe(true);
    expect(
      readFileSync(path).equals(readFileSync(join(DIST, source))),
      fixMessage('Copy differs from the installed package', [copy], version),
    ).toBe(true);
  });

  it('the stylesheet copy matches the installed package', () => {
    const { copy, source } = expectedCopies(version)[1] as { copy: string; source: string };
    const path = join(PUBLIC, copy);
    expect(existsSync(path), fixMessage('Missing copy', [copy], version)).toBe(true);
    expect(
      readFileSync(path).equals(readFileSync(join(DIST, source))),
      fixMessage('Copy differs from the installed package', [copy], version),
    ).toBe(true);
  });

  it('no copy of another version is left', () => {
    const stale = staleCopies(readdirSync(PUBLIC), version);
    expect(stale, fixMessage('Stale MapLibre copies', stale, version)).toEqual([]);
  });

  it('the failure names the fix', () => {
    expect(
      staleCopies(['maplibre-gl-worker-6.17.0.mjs', 'maplibre-gl-6.18.1.css'], '6.18.1'),
    ).toEqual(['maplibre-gl-worker-6.17.0.mjs']);
    expect(staleCopies(['maplibre-gl-6.18.10.css', 'index.html', 'fonts'], '6.18.1')).toEqual([
      'maplibre-gl-6.18.10.css',
    ]);
    expect(staleCopies(['maplibre-gl-6.18.1', 'maplibre-gl-loader-6.18.1.mjs'], '6.18.1')).toEqual(
      [],
    );

    const message = fixMessage(
      'Stale MapLibre copies',
      ['maplibre-gl-worker-6.17.0.mjs', 'maplibre-gl-6.17.0.css'],
      '6.18.1',
    );
    expect(message).toContain('maplibre-gl-worker-6.17.0.mjs');
    expect(message).toContain('maplibre-gl-6.17.0.css');
    expect(message).toContain('Copy the two files again from the installed package');
    expect(message).toContain(
      'cp apps/mobile/node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs apps/mobile/public/maplibre-gl-worker-6.18.1.mjs',
    );
    expect(message).toContain(
      'cp apps/mobile/node_modules/maplibre-gl/dist/maplibre-gl.css apps/mobile/public/maplibre-gl-6.18.1.css',
    );
  });
});
