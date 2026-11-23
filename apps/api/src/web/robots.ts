import type { Handler } from 'hono';
import type { Deps } from '../deps.ts';
import type { ApiEnv as RouterEnv } from '../router.ts';

// The paths an indexable environment keeps crawlers out of (E-WEB-03, D-446).
const DISALLOWED_PATHS: readonly string[] = [
  '/v1/',
  '/admin',
  '/settings',
  '/messages',
  '/dev/',
  '/r/',
  '/unsubscribe',
  '/m/',
  '/tiles/',
  '/map/',
];

const PLAIN_TEXT = 'text/plain; charset=utf-8';
const CACHE_CONTROL = 'public, max-age=3600'; // E-WEB-03

function line(text: string): string {
  return `${text}\n`;
}

/** The robots text: the listed paths when indexable, otherwise everything disallowed (INV-57). */
function robotsText(isIndexable: boolean): string {
  if (!isIndexable) {
    return line('User-agent: *') + line('Disallow: /');
  }
  return line('User-agent: *') + DISALLOWED_PATHS.map((path) => line(`Disallow: ${path}`)).join('');
}

/** E-WEB-03 `GET /robots.txt`: the text built once per dependencies object. */
export function robotsHandler(deps: Deps): Handler<RouterEnv> {
  let text: string | null = null;
  return (c) => {
    text ??= robotsText(deps.env.isIndexable);
    return c.text(text, 200, { 'Content-Type': PLAIN_TEXT, 'Cache-Control': CACHE_CONTROL });
  };
}
