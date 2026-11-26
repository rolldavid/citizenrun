import type { Context } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';

/** The session cookie's base name; the wire name gains `__Host-` on https (D-231). */
export const SESSION_COOKIE_BASE = 'os_session';

/**
 * How a service reads and writes its session (D-801): the cookie's base name, its `SameSite`, the
 * origin that decides the `__Host-` prefix and `Secure`, and whether a bearer token is accepted.
 */
export type SessionOptions = {
  cookieBase: string;
  sameSite: 'Lax' | 'Strict';
  cookieOrigin: string;
  acceptBearer: boolean;
};

const HTTPS_PREFIX = 'https://';
const MS_PER_SECOND = 1000;

/** Whether an origin is served over https, which gives the cookie its `__Host-` prefix and `Secure`. */
export function isHttpsOrigin(publicUrl: string): boolean {
  return publicUrl.startsWith(HTTPS_PREFIX);
}

/** The session cookie's value, or undefined when the request carries none (L-session-middleware). */
export function readSessionCookie(c: Context, options: SessionOptions): string | undefined {
  return isHttpsOrigin(options.cookieOrigin)
    ? getCookie(c, options.cookieBase, 'host')
    : getCookie(c, options.cookieBase);
}

function write(c: Context, options: SessionOptions, value: string, maxAge: number): void {
  const https = isHttpsOrigin(options.cookieOrigin);
  // Never a domain: the cookie is host-only (CTL-09).
  setCookie(c, options.cookieBase, value, {
    httpOnly: true,
    secure: https,
    sameSite: options.sameSite,
    path: '/',
    maxAge,
    ...(https ? { prefix: 'host' as const } : {}),
  });
}

/** Sets the session cookie with `Max-Age` equal to the whole seconds until `expiresAt` (CTL-09). */
export function writeSessionCookie(
  c: Context,
  options: SessionOptions,
  token: string,
  expiresAt: Date,
  now: Date,
): void {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / MS_PER_SECOND));
  write(c, options, token, maxAge);
}

/** Clears the session cookie with `Max-Age=0` (CTL-09). */
export function clearSessionCookie(c: Context, options: SessionOptions): void {
  write(c, options, '', 0);
}
