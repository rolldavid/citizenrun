// The reference ids and default relevance the templates and stages check against.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { parseYamlWith } from '../../lib/yaml.ts';

/** Office type id to power id to its default relevance (PIPE-data-relevance). */
export type RelevanceDefaults = ReadonlyMap<string, ReadonlyMap<string, 1 | 2 | 3>>;

const RelevanceFileSchema = z.record(
  z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  z.record(
    z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
    z.union([z.literal(1), z.literal(2), z.literal(3)]),
  ),
);

const IdRowsSchema = z.array(z.looseObject({ id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/) }));

/** Reads `<root>/data/relevance-defaults.yaml`; throws DataFileError on an unknown shape. */
export async function loadRelevanceDefaults(root: string): Promise<RelevanceDefaults> {
  const path = join(root, 'data', 'relevance-defaults.yaml');
  const parsed = parseYamlWith(
    await readFile(path, 'utf8'),
    'data/relevance-defaults.yaml',
    RelevanceFileSchema,
  );
  return new Map(
    Object.entries(parsed).map(
      ([type, powers]) => [type, new Map(Object.entries(powers))] as const,
    ),
  );
}

async function ids(root: string, file: string): Promise<ReadonlySet<string>> {
  const label = `data/${file}`;
  const rows = parseYamlWith(await readFile(join(root, 'data', file), 'utf8'), label, IdRowsSchema);
  return new Set(rows.map((row) => row.id));
}

/** The `id` of every row of `data/office-types.yaml` and `data/powers.yaml`. */
export async function loadReferenceIds(
  root: string,
): Promise<{ officeTypeIds: ReadonlySet<string>; powerIds: ReadonlySet<string> }> {
  const [officeTypeIds, powerIds] = await Promise.all([
    ids(root, 'office-types.yaml'),
    ids(root, 'powers.yaml'),
  ]);
  return { officeTypeIds, powerIds };
}
