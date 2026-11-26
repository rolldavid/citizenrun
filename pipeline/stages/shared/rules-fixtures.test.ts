import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { rulesFixtureInfo } from './rules-fixtures.ts';

const temps: string[] = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('rulesFixtureInfo', () => {
  it('counts the fixture files and reads the newest retrieval date', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rules-fixtures-'));
    temps.push(root);
    const dir = join(root, 'packages', 'rules', 'src', '__fixtures__', 'zz');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, '2026-general.fixtures.ts'),
      "source: { retrievedOn: '2026-11-15' }\n",
    );
    await writeFile(
      join(dir, '2025-general.fixtures.ts'),
      "source: { retrievedOn: '2026-10-01' }\n",
    );
    await writeFile(
      join(dir, 'index.ts'),
      "export const ZZ_FIXTURES = []; // retrievedOn: '2027-01-01'\n",
    );
    expect(await rulesFixtureInfo(root, 'ZZ')).toEqual({
      files: 2,
      newestRetrievedOn: '2026-11-15',
    });
  });

  it('a missing folder has no fixtures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rules-fixtures-'));
    temps.push(root);
    expect(await rulesFixtureInfo(root, 'ZZ')).toEqual({ files: 0, newestRetrievedOn: null });
  });
});
