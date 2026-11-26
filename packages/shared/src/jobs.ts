import { z } from 'zod';

// Every queue name and payload schema, so the API enqueues exactly what the worker consumes. A
// payload holds ids and small scalars only. A name and its schema arrive with the job's handler.

const Id = z.uuid();
const Empty = z.object({}).strict();

export const JOB_NAMES = [
  'ops.dead',
  'ops.alert',
  'ops.heartbeat',
  'backup.check',
  'db.connections-check',
  'cost.check',
  'account.delete',
  'account.export',
  'cleanup.retention',
  'uploads.cleanup',
  'media.process.image',
  'notify.email',
  'bundle.poll',
  'bundle.load',
  'bundle.revert',
  'score.issues',
] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** A pg-boss queue policy this product uses. */
export type QueuePolicy = 'standard' | 'singleton' | 'stately';

/**
 * Each queue's pg-boss policy, the one place it is written: the worker, the seed and the test
 * harness create queues with it, and pg-boss fixes a queue's policy when the queue is created.
 */
export const JOB_POLICIES = {
  'ops.dead': 'standard',
  'ops.alert': 'standard',
  'ops.heartbeat': 'stately',
  'backup.check': 'stately',
  'db.connections-check': 'stately',
  'cost.check': 'stately',
  'account.delete': 'standard',
  'account.export': 'standard',
  'cleanup.retention': 'stately',
  'uploads.cleanup': 'standard',
  'media.process.image': 'standard',
  'notify.email': 'standard',
  'bundle.poll': 'singleton',
  'bundle.load': 'singleton',
  'bundle.revert': 'singleton',
  'score.issues': 'standard',
} as const satisfies Record<JobName, QueuePolicy>;

/** The kinds of ops alert whose sending step exists. */
export const OpsAlertKindSchema = z.enum([
  'job_failed',
  'dump_stale',
  'connections_high',
  'bundle_stale',
  'bundle_rejected',
  'bundle_held',
  'cost_projection',
]);
export type OpsAlertKind = z.infer<typeof OpsAlertKindSchema>;

/** The kinds of moderation entry in the replay log (OPS-replay-log). */
export const ReplayKindSchema = z.enum([
  'post_removed',
  'post_restored',
  'comment_removed',
  'comment_restored',
  'user_suspended',
  'user_restored',
]);

// The item a `media.process.image` job re-encodes. Milestone 1 has avatars only.
const MediaTargetSchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('avatar'), userId: Id, uploadId: Id }).strict(),
]);

export const JOB_PAYLOADS = {
  // The dead job's own payload; never parsed or logged.
  'ops.dead': z.unknown(),
  // `values` hold queue names, counts, error class names and ids, never user data.
  'ops.alert': z
    .object({
      kind: OpsAlertKindSchema,
      values: z.record(
        z.string().regex(/^[a-z][a-zA-Z0-9]{0,39}$/),
        z.union([z.string().max(120), z.number(), z.boolean(), z.null()]),
      ),
    })
    .strict(),
  'ops.heartbeat': Empty,
  'backup.check': Empty,
  'db.connections-check': Empty,
  'cost.check': Empty,
  // skipDeferral: D-492.
  'account.delete': z.object({ userId: Id, skipDeferral: z.boolean().default(false) }).strict(),
  'account.export': z.object({ exportId: Id }).strict(),
  'cleanup.retention': z.object({ scope: z.enum(['hourly', 'nightly']) }).strict(),
  'uploads.cleanup': z.discriminatedUnion('scope', [
    z.object({ scope: z.literal('avatar'), userId: Id, uploadId: Id }).strict(),
  ]),
  'media.process.image': MediaTargetSchema,
  'notify.email': z.discriminatedUnion('template', [
    z
      .object({
        template: z.literal('signin_method_added'),
        userId: Id,
        provider: z.enum(['email', 'apple', 'google']),
      })
      .strict(),
  ]),
  'bundle.poll': Empty,
  'bundle.load': z.object({ bundleId: Id, mode: z.enum(['new', 'approved', 'reload']) }).strict(),
  'bundle.revert': z.object({ bundleId: Id, adminId: Id }).strict(),
  'score.issues': z.discriminatedUnion('scope', [
    z.object({ scope: z.literal('all') }).strict(),
    z.object({ scope: z.literal('offices'), officeIds: z.array(Id).min(1).max(5000) }).strict(),
  ]),
} as const satisfies Record<JobName, z.ZodType>;

export type JobPayload<N extends JobName> = z.infer<(typeof JOB_PAYLOADS)[N]>;
