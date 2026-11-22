import type { OpenAPIHono } from '@hono/zod-openapi';
import { createApp } from './app.ts';
import type { Deps } from './deps.ts';
import type { ApiEnv } from './router.ts';

/** The OpenAPI 3.1 document as plain JSON-shaped data (L-openapi). */
export type OpenApiDocument = Record<string, unknown>;

function sortedKeys(record: unknown): unknown {
  if (typeof record !== 'object' || record === null) {
    return record;
  }
  const entries = Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries);
}

/**
 * The OpenAPI 3.1 document of an app (L-openapi), with the keys of `paths` and of
 * `components.schemas` sorted so the output never depends on registration order or the machine.
 */
export function documentFor(app: OpenAPIHono<ApiEnv>): OpenApiDocument {
  const document = app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'API', version: '1' },
  });
  const components = document.components;
  return {
    ...document,
    paths: sortedKeys(document.paths ?? {}),
    ...(components === undefined
      ? {}
      : { components: { ...components, schemas: sortedKeys(components.schemas ?? {}) } }),
  };
}

/** Dependencies for building the document: every property read throws, because registering routes reads none. */
export function createDocDeps(): Deps {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(`deps.${String(property)} was read while building the OpenAPI document`);
      },
    },
  ) as Deps; // the proxy satisfies no member by design: any read throws
}

/** Builds the whole app over `createDocDeps()` and returns its document; nothing starts or connects. */
export function buildOpenApiDocument(): OpenApiDocument {
  return documentFor(createApp(createDocDeps()));
}
