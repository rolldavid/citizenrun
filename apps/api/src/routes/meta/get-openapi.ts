import { ErrorEnvelopeSchema, OpenApiDocumentSchema } from '@citizenrun/shared';
import type { Handler } from 'hono';
import { respond } from '../../respond.ts';
import { defineRoute } from '../../router.ts';
import type { ApiEnv, RouteContext } from '../../router.ts';

/** E-REF-03 `GET /v1/openapi.json`: the OpenAPI 3.1 document, built once. */
export const getOpenApiDocumentRoute = defineRoute({
  method: 'get',
  path: '/openapi.json',
  operationId: 'getOpenApiDocument',
  tags: ['reference'],
  responses: {
    200: {
      description: 'The OpenAPI 3.1 document.',
      content: { 'application/json': { schema: OpenApiDocumentSchema } },
    },
    429: {
      description: 'Too many requests.',
      content: { 'application/json': { schema: ErrorEnvelopeSchema } },
    },
  },
  meta: { auth: 'none', rateLimit: 'ref.openapi', public: true, clientHeader: 'exempt' },
  errors: ['rate_limited'],
});

/** The handler of E-REF-03: the document registration built, with its cache header (L-cache-headers). */
export function getOpenApiDocumentHandler(ctx: RouteContext): Handler<ApiEnv> {
  return (c) => {
    c.header('Cache-Control', 'public, max-age=300');
    return respond(c, OpenApiDocumentSchema, ctx.getOpenApiDocument());
  };
}
