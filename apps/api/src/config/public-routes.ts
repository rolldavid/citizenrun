/**
 * The routes reachable without a session (L-public-routes): every `/v1` route of level `none` or
 * `optional`, as `<METHOD> <path pattern>`, sorted. Adding one is a contract change. The local
 * development mailbox is not listed: no deployed process registers it.
 */
export const PUBLIC_ROUTES = [
  'GET /v1/issues',
  'GET /v1/office-types',
  'GET /v1/offices/:id/candidates',
  'GET /v1/offices/:idOrSlug',
  'GET /v1/openapi.json',
  'POST /v1/auth/apple',
  'POST /v1/auth/apple/callback',
  'POST /v1/auth/apple/handoff',
  'POST /v1/auth/apple/notifications',
  'POST /v1/auth/email/start',
  'POST /v1/auth/email/verify',
  'POST /v1/auth/google',
  'POST /v1/auth/logout',
  'POST /v1/auth/nonce',
  'POST /v1/client-errors',
] as const;

/** One entry of `PUBLIC_ROUTES`. */
export type PublicRoute = (typeof PUBLIC_ROUTES)[number];
