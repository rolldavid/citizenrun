import { z } from 'zod';
import type { Handler } from 'hono';
import { HealthzResponseSchema } from '@citizenrun/shared';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv as RouterEnv } from '../../router.ts';

/** E-WEB-01 `GET /healthz`: liveness, answered from the process alone. */
export const getHealthzRoute = defineRoute({
  method: 'get',
  path: '/healthz',
  operationId: 'getHealthz',
  tags: ['web'],
  responses: {
    200: {
      description: 'The process can serve a request.',
      content: { 'application/json': { schema: HealthzResponseSchema } },
    },
    429: {
      description: 'Too many requests.',
      content: { 'text/plain': { schema: z.string() } },
    },
  },
  meta: { auth: 'none', rateLimit: 'web_health' },
  errors: ['rate_limited'],
});

/** The handler of E-WEB-01: no database, bucket or queue call, so it answers during the drain. */
export function getHealthzHandler(): Handler<RouterEnv> {
  return (c) => {
    c.header('Cache-Control', 'no-store');
    return respond(c, HealthzResponseSchema, { status: 'ok' });
  };
}
