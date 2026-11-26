// `datasets seed` (D-331 rule 2, OI-local-fetches): a dataset file the owner downloaded by hand,
// because its host asks a person to answer a form, is stored as an edition the next run reads.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { SafeUrlSchema } from '@citizenrun/shared';
import { bucketKeys } from '../../lib/bucket.ts';
import { loadSources } from '../../lib/data-files.ts';
import { dataDir } from '../../lib/paths.ts';
import type { RunContext } from '../../lib/runner.ts';
import {
  EDITION_RECORD_FILE,
  EditionRecordSchema,
  readEditionRecord,
} from '../../sources/dataset.ts';

export const SEED_EDITION = /^[0-9]{4}([-0-9]{0,6})?$/;
const FILE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,199}$/;

export type SeedArgs = {
  readonly dataset: string;
  readonly edition: string;
  readonly file: string;
  readonly sourceUrl: string;
};

export type SeedOutcome =
  | { readonly exitCode: 0; readonly key: string; readonly sha256: string; readonly bytes: number }
  | { readonly exitCode: 2; readonly usage: string };

const usage = (text: string): SeedOutcome => ({ exitCode: 2, usage: text });

/**
 * Checks the arguments, streams the file to `datasets/<id>/<edition>/<file name>` and writes the
 * edition record with `seeded: true`. A usage error (an unknown dataset, an edition, file or URL
 * that is not of its form) stores nothing and exits 2.
 */
export async function seedDataset(
  ctx: RunContext,
  args: SeedArgs,
  opts: { dataDir?: string } = {},
): Promise<SeedOutcome> {
  const sources = await loadSources(opts.dataDir ?? dataDir());
  const entry = sources.find((source) => source.id === args.dataset);
  if (entry?.kind !== 'dataset') {
    return usage(`--dataset ${args.dataset} is not a dataset of data/sources.yaml`);
  }
  if (!SEED_EDITION.test(args.edition)) {
    return usage('--edition is four digits, then up to six digits and hyphens');
  }
  if (!SafeUrlSchema.safeParse(args.sourceUrl).success) {
    return usage('--source-url is an https URL that passes the safe-link check');
  }
  const name = basename(args.file);
  if (!FILE_NAME.test(name)) {
    return usage(
      '--file names a file whose name is letters, digits, dots, hyphens and underscores',
    );
  }
  let size: number;
  try {
    const info = await stat(args.file);
    if (!info.isFile()) {
      return usage('--file names a regular file');
    }
    size = info.size;
  } catch {
    return usage('--file names a file that exists');
  }
  const key = bucketKeys.dataset(entry.id, args.edition, name);
  const written = await ctx.bucket.putStream(
    key,
    createReadStream(args.file),
    'application/octet-stream',
  );
  if (written.bytes !== size) {
    throw new Error('the stored file is not the size of the file given');
  }
  const previous = await readEditionRecord(ctx, entry.id, args.edition);
  const files = (previous?.files ?? []).filter((file) => file.name !== name);
  files.push({
    name,
    url: args.sourceUrl,
    sha256: written.sha256,
    bytes: written.bytes,
    etag: null,
    last_modified: null,
  });
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  await ctx.bucket.putJson(
    bucketKeys.dataset(entry.id, args.edition, EDITION_RECORD_FILE),
    {
      dataset: entry.id,
      edition: args.edition,
      downloaded_on: ctx.today,
      source_url: args.sourceUrl,
      seeded: true,
      files,
    },
    EditionRecordSchema,
  );
  ctx.log.info('datasets_seed.done', {
    dataset: entry.id,
    edition: args.edition,
    bytes: written.bytes,
  });
  return { exitCode: 0, key, sha256: written.sha256, bytes: written.bytes };
}
