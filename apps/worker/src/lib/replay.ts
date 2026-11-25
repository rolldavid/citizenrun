import { ReplayKindSchema, SuspendedReasonSchema } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import { z } from 'zod';
import { putObject } from './bucket-ops.ts';
import type { Bucket } from './storage.ts';

// The keyed hash of a user id (A13): HMAC-SHA-256 as lower-case hex. The id never appears in clear.
const UserHash = z.string().regex(/^[0-9a-f]{64}$/);

/** One account deletion in the replay log (OPS-replay-log). `at` is an ISO instant in UTC. */
export const DeletionReplayEntrySchema = z
  .object({
    v: z.literal(1),
    kind: z.literal('account_deleted'),
    userHash: UserHash,
    at: z.iso.datetime(),
  })
  .strict();

/** One moderation change in the replay log (OPS-replay-log). `at` is an ISO instant in UTC. */
export const ModerationReplayEntrySchema = z
  .object({
    v: z.literal(1),
    kind: ReplayKindSchema,
    targetType: z.enum(['post', 'comment', 'user']),
    targetId: z.uuid().nullable(),
    userHash: UserHash.nullable(),
    reason: SuspendedReasonSchema.nullable(),
    at: z.iso.datetime(),
  })
  .strict();

export type DeletionReplayEntry = z.infer<typeof DeletionReplayEntrySchema>;
export type ModerationReplayEntry = z.infer<typeof ModerationReplayEntrySchema>;

/** The two replay prefixes; nothing else writes under `replay/`. */
export type ReplayPrefix = 'replay/deletions' | 'replay/moderation';

/** An entry or job id that does not fit its prefix's shape; no value of it is in the message. */
export class InvalidReplayEntryError extends Error {
  override readonly name = 'InvalidReplayEntryError';

  constructor() {
    super('The replay entry does not fit its prefix.');
  }
}

const JobIdSchema = z.uuid();

// The object body with the keys in the shape's order, so a retry writes the same bytes.
function bodyOf(prefix: ReplayPrefix, entry: unknown): { at: string; json: string } | null {
  if (prefix === 'replay/deletions') {
    const parsed = DeletionReplayEntrySchema.safeParse(entry);
    if (!parsed.success) {
      return null;
    }
    const { v, kind, userHash, at } = parsed.data;
    return { at, json: JSON.stringify({ v, kind, userHash, at }) };
  }
  const parsed = ModerationReplayEntrySchema.safeParse(entry);
  if (!parsed.success) {
    return null;
  }
  const { v, kind, targetType, targetId, userHash, reason, at } = parsed.data;
  return {
    at,
    json: JSON.stringify({ v, kind, targetType, targetId, userHash, reason, at }),
  };
}

/**
 * Validates the entry against its prefix's shape and the job id as a uuid, throwing
 * InvalidReplayEntryError before any bucket call when either fails, then writes
 * `<prefix>/<UTC date of entry.at>/<jobId>.json` as JSON. A retry writes the same key and bytes.
 * Logs `replay.written` with the prefix only, when `log` is given.
 */
export async function writeReplayEntry(
  backups: Bucket,
  prefix: ReplayPrefix,
  jobId: string,
  entry: DeletionReplayEntry | ModerationReplayEntry,
  log?: Logger,
): Promise<void> {
  const id = JobIdSchema.safeParse(jobId);
  const body = bodyOf(prefix, entry);
  if (!id.success || body === null) {
    throw new InvalidReplayEntryError();
  }
  const key = `${prefix}/${body.at.slice(0, 10)}/${id.data}.json`;
  await putObject(backups, key, new TextEncoder().encode(body.json), {
    contentType: 'application/json',
  });
  log?.info('replay.written', { prefix });
}
