import { z } from 'zod';

// Every queue name and payload schema, so the API enqueues exactly what the worker consumes. A
// payload holds ids and small scalars only. A name and its schema arrive with the job's handler.

const Empty = z.object({}).strict();

export const JOB_NAMES = [
  'ops.dead',
  'ops.alert',
  'ops.heartbeat',
  'backup.check',
  'db.connections-check',
  'cost.check',
] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** The kinds of ops alert whose sending step exists. */
export const OpsAlertKindSchema = z.enum([
  'job_failed',
  'dump_stale',
  'connections_high',
  'cost_projection',
]);
export type OpsAlertKind = z.infer<typeof OpsAlertKindSchema>;

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
} as const satisfies Record<JobName, z.ZodType>;

export type JobPayload<N extends JobName> = z.infer<(typeof JOB_PAYLOADS)[N]>;
