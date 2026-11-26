import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DataFileError } from '../../lib/yaml.ts';
import { repoRoot } from './repo.ts';
import { loadReferenceIds, loadRelevanceDefaults } from './reference.ts';

const temps: string[] = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('reference data', () => {
  it('reads the office type and power ids of the repository', async () => {
    const { officeTypeIds, powerIds } = await loadReferenceIds(repoRoot());
    expect(officeTypeIds.has('county-commission')).toBe(true);
    expect(officeTypeIds.has('party-precinct-committee')).toBe(true);
    expect(powerIds.has('zoning-land-use')).toBe(true);
    expect(officeTypeIds.has('zoning-land-use')).toBe(false);
  });

  it('reads the default relevance of each office type', async () => {
    const defaults = await loadRelevanceDefaults(repoRoot());
    expect(defaults.get('county-commission')?.get('zoning-land-use')).toBe(3);
    expect(defaults.get('us-house')?.get('federal-legislation')).toBe(3);
  });

  it('refuses a relevance file of another shape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reference-'));
    temps.push(root);
    await mkdir(join(root, 'data'));
    await writeFile(
      join(root, 'data', 'relevance-defaults.yaml'),
      'sheriff: { jail-and-patrol: 4 }\n',
    );
    await expect(loadRelevanceDefaults(root)).rejects.toBeInstanceOf(DataFileError);
  });
});
