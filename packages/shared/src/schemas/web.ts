import { z } from 'zod';

/** The liveness answer of `GET /healthz` (E-WEB-01). */
export const HealthzResponseSchema = z
  .object({ status: z.literal('ok') })
  .meta({ id: 'HealthzResponse' });

export type HealthzResponse = z.infer<typeof HealthzResponseSchema>;

/**
 * The readiness answer of `GET /readyz` (E-WEB-02, D-145): the database check decides the status;
 * the worker's heartbeat freshness is reported in the body only.
 */
export const ReadyzResponseSchema = z
  .object({ db: z.enum(['ok', 'down']), worker: z.enum(['ok', 'stale', 'unknown']) })
  .meta({ id: 'ReadyzResponse' });

export type ReadyzResponse = z.infer<typeof ReadyzResponseSchema>;
