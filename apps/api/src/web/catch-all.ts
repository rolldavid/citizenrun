import type { Context, Env, MiddlewareHandler } from 'hono';
import { brandVariant, createI18n, routeClassOf } from '@citizenrun/shared';
import type { Deps } from '../deps.ts';
import { isV1Path } from '../middleware/route-meta.ts';
import {
  SESSION_TOKEN_PATTERN,
  publicSessionOptions,
  resolveSession,
} from '../middleware/session.ts';
import { readSessionCookie } from '../middleware/session-cookie.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import { webAssetsFor } from './assets.ts';
import { fillShell } from './shell.ts';

const PLAIN_TEXT = 'text/plain; charset=utf-8';
const HTML = 'text/html; charset=utf-8';

/**
 * A step of the catch-all row that a `/v1` path skips (D-824): the row's `*` also matches an
 * unclaimed `/v1` `GET` and every `/v1` route mounted after it, which the `web_page` limiter must
 * not count and `compress` must not gzip.
 */
export function webOnly<E extends Env>(step: MiddlewareHandler<E>): MiddlewareHandler<E> {
  return async (c, next) => {
    if (isV1Path(c.req.path)) {
      await next();
      return;
    }
    return step(c, next);
  };
}

// One English translator per process, made on the first not-found page: importing this file
// creates nothing.
let i18n: ReturnType<typeof createI18n> | null = null;

function englishT(): ReturnType<typeof createI18n>['t'] {
  i18n ??= createI18n({ lng: 'en' });
  return i18n.getFixedT('en');
}

/**
 * Whether the request carries a valid session cookie (D-461). The cookie is read only through
 * `readSessionCookie`, which picks the `__Host-` name on an https `PUBLIC_URL`; a bearer header is
 * ignored here, and a value that is not a token's shape is no session. Nothing is written.
 */
async function hasViewer(c: Context<RouterEnv>, deps: Deps): Promise<boolean> {
  const token = readSessionCookie(c, publicSessionOptions(deps.env.PUBLIC_URL));
  if (token === undefined || !SESSION_TOKEN_PATTERN.test(token)) {
    return false;
  }
  return (await resolveSession(deps.db, token, deps.clock.now())) !== null;
}

/**
 * E-WEB-05: the shell for every `GET` and `HEAD` path no earlier route claimed, with the shell's
 * policy (report-only until enforced). A `/v1` path passes on, so a later `/v1` route still answers
 * and an unclaimed one gets the envelope 404; every other path answers 404 when no export exists.
 * The path is classified with `routeClassOf` (L-route-classes): a `session` path with no valid
 * session cookie answers 302 to `/?next=<path>`, an `onboarding` path 302 to `/welcome`; an
 * `unknown` path, and a `dev` path while dev routes are off, get the shell with status 404, the
 * not-found title and `noindex`; everything else gets the plain shell with the variant's display
 * name as its title. The query string never reaches `next`, and the shell sets no cookie.
 */
export function shellHandler(deps: Deps): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    const path = c.req.path;
    if (isV1Path(path)) {
      await next();
      return;
    }
    const assets = await webAssetsFor(deps);
    if (assets === null) {
      c.set('errorCode', 'not_found');
      return c.text('Not found', 404, { 'Content-Type': PLAIN_TEXT });
    }
    const routeClass = routeClassOf(path);
    if ((routeClass === 'session' || routeClass === 'onboarding') && !(await hasViewer(c, deps))) {
      const location = routeClass === 'session' ? `/?next=${encodeURIComponent(path)}` : '/welcome';
      return c.body(null, 302, {
        Location: location,
        'Cache-Control': 'no-store',
        Vary: 'Cookie',
      });
    }
    const appName = brandVariant(deps.env.variant).displayName;
    const notFound = routeClass === 'unknown' || (routeClass === 'dev' && !deps.env.devRoutes);
    if (notFound) {
      c.set('errorCode', 'not_found');
    }
    const html = notFound
      ? fillShell(assets.shell, {
          title: englishT()('common:notFound.title', { appName }),
          noindex: true,
        })
      : fillShell(assets.shell, { title: appName });
    return c.body(html, notFound ? 404 : 200, {
      'Content-Type': HTML,
      'Content-Length': String(Buffer.byteLength(html, 'utf8')),
      'Cache-Control': 'no-cache',
      Vary: 'Cookie',
      [assets.csp.header]: assets.csp.value,
    });
  };
}
