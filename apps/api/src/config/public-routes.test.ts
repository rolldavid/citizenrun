import { describe, expect, it } from 'vitest';
import { buildOpenApiDocument } from '../openapi.ts';
import { PUBLIC_ROUTES } from './public-routes.ts';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Every /v1 operation of the served document whose x-route auth is none or optional, as
// `<METHOD> <path>` with `{param}` written `:param`. The health routes are outside /v1 and so
// outside the list (L-public-routes, D-465).
function loggedOutOperations(): string[] {
  const paths = buildOpenApiDocument()['paths'];
  if (!isRecord(paths)) {
    throw new Error('The document has no paths.');
  }
  const found: string[] = [];
  for (const [path, item] of Object.entries(paths)) {
    if (!isRecord(item) || !path.startsWith('/v1/')) {
      continue;
    }
    for (const method of METHODS) {
      const operation = item[method];
      if (!isRecord(operation)) {
        continue;
      }
      const route = operation['x-route'];
      if (isRecord(route) && (route['auth'] === 'none' || route['auth'] === 'optional')) {
        found.push(`${method.toUpperCase()} ${path.replaceAll(/\{(.+?)\}/g, ':$1')}`);
      }
    }
  }
  return found;
}

describe('PUBLIC_ROUTES', () => {
  it('sorted and unique', () => {
    expect([...PUBLIC_ROUTES]).toEqual([...PUBLIC_ROUTES].sort());
    expect(new Set(PUBLIC_ROUTES).size).toBe(PUBLIC_ROUTES.length);
  });

  it('every entry names a method and a /v1 path', () => {
    for (const entry of PUBLIC_ROUTES) {
      expect(entry).toMatch(/^(GET|POST|PUT|PATCH|DELETE) \/v1\/[a-z0-9./:-]+$/);
    }
  });

  it('the development mailbox is not listed', () => {
    expect(PUBLIC_ROUTES).not.toContain('POST /v1/dev/mailbox');
  });

  it('every registered none or optional route is listed', () => {
    const operations = loggedOutOperations();
    expect(operations).toContain('POST /v1/client-errors');
    expect(operations).toContain('GET /v1/openapi.json');
    const listed: ReadonlySet<string> = new Set(PUBLIC_ROUTES);
    expect(operations.filter((operation) => !listed.has(operation))).toEqual([]);
  });
});
