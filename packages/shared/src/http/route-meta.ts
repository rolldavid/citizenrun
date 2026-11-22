/** The auth level every route declares (L-route-meta). */
export type AuthLevel = 'none' | 'optional' | 'user' | 'onboarded' | 'admin';

/**
 * The metadata every route definition carries as `x-route` (L-route-meta). `P` is the rate-limit
 * policy name; the API narrows it to a key of its policies object.
 */
export type RouteMeta<P extends string = string> = {
  auth: AuthLevel;
  rateLimit: P;
  recentSignIn?: '15m'; // a sign-in within the last 15 minutes is required
  allowWhenSuspended?: true; // a write a suspended account may still make
  clientHeader?: 'exempt'; // default: X-OS-Client is required
  originCheck?: 'exempt'; // default: the request-forgery check applies
  bodyLimitBytes?: number; // default: 65,536 (L-body-limit)
  public?: true; // listed in the logged-out allowlist
  errorRedirect?: true; // every refusal becomes a redirect, never a JSON envelope
};
