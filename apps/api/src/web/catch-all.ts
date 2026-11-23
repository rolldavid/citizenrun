import type { MiddlewareHandler } from 'hono';
import { brandVariant } from '@citizenrun/shared';
import type { Deps } from '../deps.ts';
import { isV1Path } from '../middleware/route-meta.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import { webAssetsFor } from './assets.ts';
import { fillShell } from './shell.ts';

const PLAIN_TEXT = 'text/plain; charset=utf-8';
const HTML = 'text/html; charset=utf-8';

function isDevPath(path: string): boolean {
  return path === '/dev' || path.startsWith('/dev/');
}

/**
 * E-WEB-05: the shell for every `GET` and `HEAD` path no earlier route claimed, with the variant's
 * display name as its title and the shell's policy (report-only until enforced). A `/v1` path
 * passes on, so a later `/v1` route still answers and an unclaimed one gets the envelope 404.
 * `/dev` paths answer 404 while dev routes are off, and so does every path when no export exists.
 */
export function shellHandler(deps: Deps): MiddlewareHandler<RouterEnv> {
  return async (c, next) => {
    const path = c.req.path;
    if (isV1Path(path)) {
      await next();
      return;
    }
    const assets = isDevPath(path) && !deps.env.devRoutes ? null : await webAssetsFor(deps);
    if (assets === null) {
      c.set('errorCode', 'not_found');
      return c.text('Not found', 404, { 'Content-Type': PLAIN_TEXT });
    }
    const html = fillShell(assets.shell, { title: brandVariant(deps.env.variant).displayName });
    return c.body(html, 200, {
      'Content-Type': HTML,
      'Content-Length': String(Buffer.byteLength(html, 'utf8')),
      'Cache-Control': 'no-cache',
      Vary: 'Cookie',
      [assets.csp.header]: assets.csp.value,
    });
  };
}
