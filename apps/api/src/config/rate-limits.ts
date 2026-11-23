/** One rule of a rate-limit policy (L-rate-limit-memory, L-rate-limit-db). */
export type RateLimitRule = {
  subject: 'user' | 'ip'; // 'user' rules apply only when a viewer exists
  action: string; // the action segment of the key, lower snake_case
  limit: number; // requests allowed per window
  window: '1m' | '1h' | '1d';
  store: 'db' | 'memory'; // 'memory' only for anonymous read paths (D-240)
  when?: 'logged_out'; // the rule applies only when the request has no viewer
};

/** Every rate-limit policy, by name; each route names exactly one. */
export const RATE_LIMIT_POLICIES = {
  'ref.openapi': [{ subject: 'ip', action: 'openapi', limit: 30, window: '1m', store: 'memory' }], // E-REF-03
  // E-SAFE-02, D-408
  clientErrors: [
    { subject: 'user', action: 'client_err', limit: 20, window: '1m', store: 'memory' },
    { subject: 'ip', action: 'client_err', limit: 20, window: '1m', store: 'memory' },
  ],
  web_health: [{ subject: 'ip', action: 'web_health', limit: 600, window: '1m', store: 'memory' }], // E-WEB-01, E-WEB-02
  web_static: [{ subject: 'ip', action: 'web_static', limit: 1200, window: '1m', store: 'memory' }], // E-WEB-04
  web_page: [{ subject: 'ip', action: 'web_page', limit: 240, window: '1m', store: 'memory' }], // E-WEB-05
  web_seo: [{ subject: 'ip', action: 'web_seo', limit: 120, window: '1m', store: 'memory' }], // E-WEB-03
} as const satisfies Readonly<Record<string, readonly RateLimitRule[]>>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;
