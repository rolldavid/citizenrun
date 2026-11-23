import { z } from 'zod';

/** The JSON written beside each dump (OPS-backup-job), with its keys in this order. */
export const BackupManifestSchema = z.strictObject({
  v: z.literal(1),
  createdAt: z.iso.datetime(),
  environment: z.enum(['local', 'ci', 'staging', 'production']),
  objectKey: z.string().regex(/^pg\/\d{4}\/\d{2}\/\d{8}T\d{6}Z\.dump\.enc$/),
  plainBytes: z.int().nonnegative(),
  encryptedBytes: z.int().positive(),
  encryptedSha256: z.string().regex(/^[0-9a-f]{64}$/),
  publicKeyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  pgDumpVersion: z.string().min(1).max(200),
  serverVersion: z.string().min(1).max(500),
  migrationHead: z.object({ hash: z.string().min(1).max(128), createdAt: z.int() }).nullable(),
  tableEstimates: z.record(z.string().max(200), z.int().nonnegative()),
  durationMs: z.int().nonnegative(),
});

export type BackupManifest = z.infer<typeof BackupManifestSchema>;

const STAMP_PATTERN = /^(\d{4})(\d{2})\d{2}T\d{6}Z$/;

/** The UTC stamp of `at` as `YYYYMMDDTHHMMSSZ`, whatever the process zone. */
export function backupStamp(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 19).replace(/[-:]/g, '')}Z`;
}

/** The object keys of a dump and its manifest: `pg/<YYYY>/<MM>/<stamp>.dump.enc` and `.json`. */
export function backupObjectKeys(stamp: string): { dumpKey: string; manifestKey: string } {
  const match = STAMP_PATTERN.exec(stamp);
  const year = match?.[1];
  const month = match?.[2];
  if (year === undefined || month === undefined) {
    throw new RangeError('not a backup stamp');
  }
  const base = `pg/${year}/${month}/${stamp}`;
  return { dumpKey: `${base}.dump.enc`, manifestKey: `${base}.json` };
}

/** The manifest with `v` 1, in the contract's key order; throws when a field or an extra key is refused. */
export function buildManifest(input: Omit<BackupManifest, 'v'>): BackupManifest {
  const ordered = {
    v: 1,
    createdAt: input.createdAt,
    environment: input.environment,
    objectKey: input.objectKey,
    plainBytes: input.plainBytes,
    encryptedBytes: input.encryptedBytes,
    encryptedSha256: input.encryptedSha256,
    publicKeyFingerprint: input.publicKeyFingerprint,
    pgDumpVersion: input.pgDumpVersion,
    serverVersion: input.serverVersion,
    migrationHead: input.migrationHead,
    tableEstimates: input.tableEstimates,
    durationMs: input.durationMs,
  };
  // Spreading the input after the ordered keys keeps their order and lets the strict schema see,
  // and refuse, any key the input carries beyond them.
  return BackupManifestSchema.parse({ ...ordered, ...input });
}
