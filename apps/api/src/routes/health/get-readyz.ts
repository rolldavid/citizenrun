import { z } from 'zod';
import type { Handler } from 'hono';
import { ReadyzResponseSchema } from '@citizenrun/shared';
import type { Deps } from '../../deps.ts';
import { JSON_CONTENT_TYPE, respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';
import { getReadiness } from '../../services/health/get-readiness.ts';

/** E-WEB-02 `GET /readyz`: readiness, decided by the database check alone (D-145). */
export const getReadyzRoute = defineRoute({
  method: 'get',
  path: '/readyz',
  operationId: 'getReadyz',
  tags: ['web'],
  responses: {
    200: {
      description: 'The database answers; the worker heartbeat is fresh or stale.',
      content: { 'application/json': { schema: ReadyzResponseSchema } },
    },
    429: {
      description: 'Too many requests.',
      content: { 'text/plain': { schema: z.string() } },
    },
    503: {
      description: 'The database does not answer, or the process is draining.',
      content: { 'application/json': { schema: ReadyzResponseSchema } },
    },
  },
  meta: { auth: 'none', rateLimit: 'web_health' },
  errors: ['unavailable', 'rate_limited'],
});

/**
 * The handler of E-WEB-02. `/readyz` is outside `/v1`, and `respond` answers 2xx only, so the 503
 * body is parsed with the same schema and written directly.
 */
export function getReadyzHandler(deps: Deps): Handler<RouterEnv> {
  return async (c) => {
    const now = deps.clock.now();
    const { status, body } = await getReadiness(deps, now);
    c.header('Cache-Control', 'no-store');
    if (status === 200) {
      return respond(c, ReadyzResponseSchema, body);
    }
    return c.json(ReadyzResponseSchema.parse(body), 503, { 'Content-Type': JSON_CONTENT_TYPE });
  };
}
