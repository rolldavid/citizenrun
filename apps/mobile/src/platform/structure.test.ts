import { describe, expect, it } from 'vitest';

// PM-structure: the folder's shape, read as text. No file system and no module import: an index file loaded as
// a module would pull native libraries into this project.
const typesFiles = import.meta.glob('./*/types.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const nativeTs = import.meta.glob('./*/index.native.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const nativeTsx = import.meta.glob('./*/index.native.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const webTs = import.meta.glob('./*/index.web.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const webTsx = import.meta.glob('./*/index.web.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const plainTs = import.meta.glob('./*/index.ts', { query: '?raw', import: 'default', eager: true });
const plainTsx = import.meta.glob('./*/index.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const rootFiles = import.meta.glob('./*.*', { query: '?raw', import: 'default', eager: true });

type ModuleRow = { folder: string; runtimeExport: string; extension: 'ts' | 'tsx' };

const MODULES: readonly ModuleRow[] = [
  { folder: 'session', runtimeExport: 'session', extension: 'ts' },
  { folder: 'map', runtimeExport: 'map', extension: 'tsx' },
  { folder: 'upload', runtimeExport: 'upload', extension: 'ts' },
  { folder: 'push', runtimeExport: 'push', extension: 'ts' },
  { folder: 'share', runtimeExport: 'share', extension: 'ts' },
  { folder: 'location', runtimeExport: 'location', extension: 'ts' },
  { folder: 'haptics', runtimeExport: 'haptics', extension: 'ts' },
  { folder: 'calendar', runtimeExport: 'calendar', extension: 'ts' },
  { folder: 'auth', runtimeExport: 'auth', extension: 'tsx' },
  { folder: 'pdf', runtimeExport: 'pdf', extension: 'ts' },
  { folder: 'video', runtimeExport: 'video', extension: 'tsx' },
  { folder: 'storage', runtimeExport: 'storage', extension: 'ts' },
  { folder: 'links', runtimeExport: 'links', extension: 'ts' },
  { folder: 'age-assurance', runtimeExport: 'ageAssurance', extension: 'ts' },
  { folder: 'query-client', runtimeExport: 'queryClient', extension: 'ts' },
  { folder: 'head', runtimeExport: 'head', extension: 'tsx' },
];

const RUNTIME_EXPORT = /^export const ([A-Za-z]+)\b/gm;

function folderOf(key: string): string {
  return key.split('/')[1] ?? '';
}

/** The index files of one platform for a folder, as `index.<platform>.<ext>` names. */
function indexFiles(platform: 'native' | 'web', folder: string): string[] {
  const [ts, tsx] = platform === 'native' ? [nativeTs, nativeTsx] : [webTs, webTsx];
  return [...Object.keys(ts), ...Object.keys(tsx)]
    .filter((key) => folderOf(key) === folder)
    .map((key) => key.split('/')[2] ?? '');
}

describe('the platform folder', () => {
  it('sixteen folders', () => {
    const folders = new Set(Object.keys(typesFiles).map(folderOf));
    expect(folders).toEqual(new Set(MODULES.map((row) => row.folder)));
    expect(folders.size).toBe(16);
  });

  it('three files each', () => {
    for (const { folder, extension } of MODULES) {
      expect(Object.hasOwn(typesFiles, `./${folder}/types.ts`), folder).toBe(true);
      expect(indexFiles('native', folder), folder).toEqual([`index.native.${extension}`]);
      expect(indexFiles('web', folder), folder).toEqual([`index.web.${extension}`]);
    }
  });

  it('no index file without a platform', () => {
    expect(Object.keys(plainTs)).toEqual([]);
    expect(Object.keys(plainTsx)).toEqual([]);
  });

  it('one runtime export', () => {
    const expected = new Map(MODULES.map((row) => [row.folder, row.runtimeExport]));
    const sources = Object.entries({ ...nativeTs, ...nativeTsx, ...webTs, ...webTsx });
    expect(sources).toHaveLength(32);
    for (const [key, source] of sources) {
      const names = [...source.matchAll(RUNTIME_EXPORT)].map((match) => match[1]);
      expect(names, key).toEqual([expected.get(folderOf(key))]);
      expect(source.includes("export type * from './types';"), key).toBe(true);
    }
  });

  it('no stray files at the root', () => {
    // Vite leaves the importing file out of its own glob, so this file is added by name.
    const files = [...Object.keys(rootFiles), './structure.test.ts'].sort();
    expect(files).toEqual(['./shared.ts', './structure.test.ts']);
  });

  it('types files import only types', () => {
    expect(Object.keys(typesFiles)).toHaveLength(16);
    for (const [key, source] of Object.entries(typesFiles)) {
      expect(/^import (?!type )/m.test(source), key).toBe(false);
    }
  });
});
