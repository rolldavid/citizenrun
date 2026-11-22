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
} as const satisfies Readonly<Record<string, readonly RateLimitRule[]>>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;
