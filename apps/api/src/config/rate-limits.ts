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
  'auth.emailStart': [{ subject: 'ip', action: 'auth_code', limit: 10, window: '1h', store: 'db' }], // E-AUTH-01
  'auth.emailVerify': [
    { subject: 'ip', action: 'auth_verify', limit: 60, window: '1h', store: 'db' },
  ], // E-AUTH-02, D-462
  'auth.nonce': [{ subject: 'ip', action: 'auth_nonce', limit: 60, window: '1h', store: 'db' }], // E-AUTH-03
  'auth.token': [{ subject: 'ip', action: 'auth_token', limit: 60, window: '1h', store: 'db' }], // E-AUTH-04, E-AUTH-06, E-AUTH-08
  'auth.appleCallback': [
    { subject: 'ip', action: 'apple_callback', limit: 30, window: '1h', store: 'db' },
  ], // E-AUTH-05
  'auth.appleNotify': [
    { subject: 'ip', action: 'apple_notify', limit: 600, window: '1h', store: 'db' },
  ], // E-AUTH-07
  'dev.mailbox': [
    { subject: 'ip', action: 'dev_mailbox', limit: 120, window: '1m', store: 'memory' },
  ], // E-AUTH-11
  // E-AUTH-09, E-AUTH-10
  'auth.logout': [
    { subject: 'user', action: 'logout', limit: 30, window: '1m', store: 'db' },
    { subject: 'ip', action: 'logout', limit: 60, window: '1m', store: 'db' },
  ],
  'me.read': [{ subject: 'user', action: 'me_read', limit: 120, window: '1m', store: 'db' }], // E-ME-01, E-ME-05, E-ME-18
  'me.write': [{ subject: 'user', action: 'me_write', limit: 30, window: '1m', store: 'db' }], // E-ME-02, E-ME-09, E-ME-10, E-ME-11, E-ME-12, E-ME-16
  'me.delete': [{ subject: 'user', action: 'me_delete', limit: 5, window: '1h', store: 'db' }], // E-ME-03
  'me.export': [{ subject: 'user', action: 'me_export', limit: 10, window: '1h', store: 'db' }], // E-ME-04, E-ME-06
  'me.handleCheck': [
    { subject: 'user', action: 'handle_check', limit: 60, window: '1m', store: 'db' },
  ], // E-ME-07
  'me.handleSet': [{ subject: 'user', action: 'handle_set', limit: 10, window: '1h', store: 'db' }], // E-ME-08
  'ref.read': [{ subject: 'ip', action: 'ref_read', limit: 120, window: '1m', store: 'memory' }], // E-REF-01, E-REF-02
  'ref.openapi': [{ subject: 'ip', action: 'openapi', limit: 30, window: '1m', store: 'memory' }], // E-REF-03
  // E-GEO-01
  'geo.suggest': [
    { subject: 'user', action: 'geo_suggest', limit: 30, window: '1m', store: 'db' },
    { subject: 'user', action: 'geo_suggest_day', limit: 150, window: '1d', store: 'db' },
  ],
  'uploads.create': [{ subject: 'user', action: 'uploads', limit: 30, window: '1m', store: 'db' }], // E-UPL-01
  // E-SAFE-02, D-408
  clientErrors: [
    { subject: 'user', action: 'client_err', limit: 20, window: '1m', store: 'db' },
    { subject: 'ip', action: 'client_err', limit: 20, window: '1m', store: 'memory' },
  ],
  web_health: [{ subject: 'ip', action: 'web_health', limit: 600, window: '1m', store: 'memory' }], // E-WEB-01, E-WEB-02
  web_static: [{ subject: 'ip', action: 'web_static', limit: 1200, window: '1m', store: 'memory' }], // E-WEB-04
  web_page: [{ subject: 'ip', action: 'web_page', limit: 240, window: '1m', store: 'memory' }], // E-WEB-05
  web_seo: [{ subject: 'ip', action: 'web_seo', limit: 120, window: '1m', store: 'memory' }], // E-WEB-03
  // E-OFF-01, E-OFF-02, E-PPL-01: one per-address budget for the logged-out civic reads (CTL-43, CTL-39)
  civic_read: [
    { subject: 'user', action: 'civic', limit: 600, window: '1m', store: 'db' },
    {
      subject: 'ip',
      action: 'civic',
      limit: 240,
      window: '1m',
      store: 'memory',
      when: 'logged_out',
    },
  ],
  explore_list: [{ subject: 'user', action: 'explore', limit: 120, window: '1m', store: 'db' }], // E-EXP-01
  office_toggle: [{ subject: 'user', action: 'toggle', limit: 120, window: '1m', store: 'db' }], // E-OFF-04 to E-OFF-07
  field_report: [{ subject: 'user', action: 'freport', limit: 5, window: '1m', store: 'db' }], // E-OFF-09; the daily limit is counted from field_reports
  // D-854: a /v1 request that no route's metadata matches
  'v1.unmatched': [
    { subject: 'ip', action: 'v1_unmatched', limit: 120, window: '1m', store: 'memory' },
  ],
} as const satisfies Readonly<Record<string, readonly RateLimitRule[]>>;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;
