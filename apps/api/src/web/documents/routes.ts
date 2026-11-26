// E-WEB-06 to E-WEB-08: the three legal pages, rendered at start and served from memory.
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { Handler } from 'hono';
import { compress } from 'hono/compress';
import { buildShellCsp, cspInputs, shellCspHeaderName } from '../../config/csp.ts';
import type { Deps } from '../../deps.ts';
import { limit } from '../../middleware/rate-limit.ts';
import type { ApiEnv } from '../../router.ts';
import { webAssetsFor } from '../assets.ts';
import { LEGAL_PAGES } from './load.ts';
import type { LegalPageId } from './load.ts';

const HTML = 'text/html; charset=utf-8';
const CACHE_CONTROL = 'public, max-age=300'; // E-WEB-06

type Policy = { header: string; value: string };

// The one policy of L-csp, read once per dependencies object: the shell's when the web export
// exists, otherwise the same directives without the shell template's hashes. Either way style-src
// holds the document stylesheet's hash from pageHashes.
const policies = new WeakMap<Deps, Promise<Policy>>();

async function loadPolicy(deps: Deps): Promise<Policy> {
  const assets = await webAssetsFor(deps);
  if (assets !== null) {
    return assets.csp;
  }
  return {
    header: shellCspHeaderName(),
    value: buildShellCsp(cspInputs(deps.env, { scriptHashes: [], styleHashes: [] })),
  };
}

function policyFor(deps: Deps): Promise<Policy> {
  let policy = policies.get(deps);
  if (policy === undefined) {
    policy = loadPolicy(deps);
    policies.set(deps, policy);
  }
  return policy;
}

// Reads deps.documents only when a request arrives: building the OpenAPI document reads no member.
function documentHandler(deps: Deps, id: LegalPageId): Handler<ApiEnv> {
  return async (c) => {
    const html = deps.documents[id];
    const policy = await policyFor(deps);
    return c.body(html, 200, {
      'Content-Type': HTML,
      'Content-Length': String(Buffer.byteLength(html, 'utf8')),
      'Cache-Control': CACHE_CONTROL,
      [policy.header]: policy.value,
    });
  };
}

/**
 * Attaches `GET` (and so `HEAD`) for each legal page: level `none`, no session read, the
 * `web_page` limiter in memory, gzip when accepted (E-WEB-06 to E-WEB-08).
 */
export function registerDocumentRoutes(app: OpenAPIHono<ApiEnv>, deps: Deps): void {
  for (const page of LEGAL_PAGES) {
    app.get(
      page.path,
      limit(deps, 'web_page'),
      compress({ encoding: 'gzip' }),
      documentHandler(deps, page.id),
    );
  }
}
