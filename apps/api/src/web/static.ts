import { stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Context, MiddlewareHandler } from 'hono';
import type { Deps } from '../deps.ts';
import { isV1Path } from '../middleware/route-meta.ts';
import { checkRateLimitPolicy } from '../middleware/rate-limit.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';
import { cacheControlFor, webAssetsFor } from './assets.ts';
import type { CompressedFile } from './assets.ts';

const PLAIN_TEXT = 'text/plain; charset=utf-8';
// A `..` segment, between slashes or backslashes or at either end (E-WEB-04).
const PARENT_SEGMENT = /(?:^|[/\\])\.\.(?:[/\\]|$)/;
const INDEX_PATH = '/index.html';

type Encoding = 'br' | 'gzip';

// The q-value the Accept-Encoding header gives one coding, through `*` when it is not named.
function acceptedQuality(header: string, coding: string): number {
  let named: number | null = null;
  let wildcard: number | null = null;
  for (const part of header.split(',')) {
    const [name = '', ...params] = part.split(';').map((piece) => piece.trim());
    const qParam = params.find((param) => param.toLowerCase().startsWith('q='));
    const q = qParam === undefined ? 1 : Number(qParam.slice(2));
    const quality = Number.isFinite(q) ? q : 0;
    const lower = name.toLowerCase();
    if (lower === coding) {
      named = quality;
    } else if (lower === '*') {
      wildcard = quality;
    }
  }
  return named ?? wildcard ?? 0;
}

// Brotli when the request allows it, else gzip, else none (E-WEB-04).
function preferredEncoding(header: string | undefined): Encoding | null {
  if (header === undefined) {
    return null;
  }
  if (acceptedQuality(header, 'br') > 0) {
    return 'br';
  }
  return acceptedQuality(header, 'gzip') > 0 ? 'gzip' : null;
}

function notFoundText(c: Context<RouterEnv>): Response {
  c.set('errorCode', 'not_found');
  return c.text('Not found', 404, { 'Content-Type': PLAIN_TEXT });
}

// Whether the URL path names a regular file inside the export folder.
async function isRegularFile(root: string, urlPath: string): Promise<boolean> {
  const file = resolve(root, `.${urlPath}`);
  if (!file.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
    return false;
  }
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function answerCompressed(
  c: Context<RouterEnv>,
  file: CompressedFile,
  encoding: Encoding,
): Response {
  const body = encoding === 'br' ? file.br : file.gzip;
  return c.body(body, 200, {
    'Content-Type': file.contentType,
    'Content-Encoding': encoding,
    'Content-Length': String(body.byteLength),
    'Cache-Control': file.cacheControl,
    Vary: 'Accept-Encoding',
  });
}

/**
 * E-WEB-04, for `GET` and `HEAD`: files of the web export with the cache header of their path, a
 * Brotli or gzip copy from memory where the request allows one, `/index.html` sent to `/`, and a
 * path with a `..` segment refused. A path under `/v1`, or one that names no file, passes on.
 * Each file request counts against `web_static`.
 */
export function staticFiles(deps: Deps): MiddlewareHandler<RouterEnv> {
  // One serveStatic per export folder, made on first use.
  const servers = new Map<string, MiddlewareHandler<RouterEnv>>();
  const serverFor = (root: string): MiddlewareHandler<RouterEnv> => {
    let server = servers.get(root);
    if (server === undefined) {
      server = serveStatic<RouterEnv>({
        root,
        // The headers set before serving belong to the file only, never to what answers instead.
        onNotFound: (_path, c) => {
          c.header('Cache-Control', undefined);
          c.header('Vary', undefined);
        },
      });
      servers.set(root, server);
    }
    return server;
  };

  return async (c, next) => {
    const method = c.req.method;
    const path = c.req.path;
    if ((method !== 'GET' && method !== 'HEAD') || isV1Path(path)) {
      await next();
      return;
    }
    if (path === INDEX_PATH) {
      return c.redirect('/', 301);
    }
    if (PARENT_SEGMENT.test(path)) {
      return notFoundText(c);
    }
    const assets = await webAssetsFor(deps);
    if (assets === null) {
      await next();
      return;
    }
    const compressed = assets.compressed.get(path);
    if (compressed === undefined && !(await isRegularFile(assets.root, path))) {
      await next();
      return;
    }
    const result = await checkRateLimitPolicy(deps, {
      policy: 'web_static',
      userId: null,
      addrHash: c.get('addrHash'),
      now: deps.clock.now(),
    });
    if (!result.ok) {
      c.set('errorCode', 'rate_limited');
      return c.text('Too many requests', 429, {
        'Content-Type': PLAIN_TEXT,
        'Retry-After': String(result.retryAfterSeconds),
      });
    }
    if (compressed !== undefined) {
      const encoding = preferredEncoding(c.req.header('Accept-Encoding'));
      if (encoding !== null) {
        return answerCompressed(c, compressed, encoding);
      }
      // The plain copy of a file that is also served compressed varies by the request's encoding.
      c.header('Vary', 'Accept-Encoding');
    }
    // Set before serving: serveStatic builds its response before its found callback runs.
    c.header('Cache-Control', cacheControlFor(path));
    return serverFor(assets.root)(c, next);
  };
}
