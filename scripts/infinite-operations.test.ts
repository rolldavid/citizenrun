import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { INFINITE_OPERATIONS } from '@citizenrun/shared';
import { repoRoot } from './lib/repo-root.ts';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Follows a local `$ref` (`#/components/...`) to the object it names; any other value is returned as is. */
function resolveRef(document: Json, value: unknown): unknown {
  if (!isObject(value) || typeof value['$ref'] !== 'string') {
    return value;
  }
  const ref = value['$ref'];
  if (!ref.startsWith('#/')) {
    throw new Error(`unsupported reference ${ref}`);
  }
  let current: unknown = document;
  for (const segment of ref.slice(2).split('/')) {
    current = isObject(current) ? current[segment] : undefined;
  }
  if (current === undefined) {
    throw new Error(`unresolved reference ${ref}`);
  }
  return resolveRef(document, current);
}

function hasCursorQuery(document: Json, operation: Json): boolean {
  const parameters = operation['parameters'];
  if (!Array.isArray(parameters)) {
    return false;
  }
  return parameters.some((parameter: unknown) => {
    const resolved = resolveRef(document, parameter);
    return isObject(resolved) && resolved['in'] === 'query' && resolved['name'] === 'cursor';
  });
}

function hasNextCursor(document: Json, operation: Json): boolean {
  const responses = operation['responses'];
  const ok = resolveRef(document, isObject(responses) ? responses['200'] : undefined);
  const content = isObject(ok) ? ok['content'] : undefined;
  const json = isObject(content) ? content['application/json'] : undefined;
  const schema = resolveRef(document, isObject(json) ? json['schema'] : undefined);
  const properties = isObject(schema) ? schema['properties'] : undefined;
  return isObject(properties) && 'nextCursor' in properties;
}

/** The operation ids of every GET with a `cursor` query parameter and `nextCursor` in its 200 body, sorted. */
function pagedGetOperations(document: Json): string[] {
  const ids: string[] = [];
  const paths = document['paths'];
  for (const item of Object.values(isObject(paths) ? paths : {})) {
    const operation = isObject(item) ? item['get'] : undefined;
    if (!isObject(operation) || typeof operation['operationId'] !== 'string') {
      continue;
    }
    if (hasCursorQuery(document, operation) && hasNextCursor(document, operation)) {
      ids.push(operation['operationId']);
    }
  }
  return ids.sort();
}

async function committedDocument(): Promise<Json> {
  const parsed: unknown = JSON.parse(
    await readFile(join(repoRoot(), 'apps/api/openapi.json'), 'utf8'),
  );
  if (!isObject(parsed)) {
    throw new Error('apps/api/openapi.json is not an object');
  }
  return parsed;
}

// An invented document with one paged list, one unpaged list and one paged POST.
const FIXTURE_DOCUMENT: Json = {
  paths: {
    '/v1/things': {
      get: {
        operationId: 'listThings',
        parameters: [{ $ref: '#/components/parameters/Cursor' }, { in: 'query', name: 'limit' }],
        responses: {
          '200': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ThingPage' } } },
          },
        },
      },
      post: {
        operationId: 'createThing',
        parameters: [{ in: 'query', name: 'cursor' }],
        responses: {
          '200': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ThingPage' } } },
          },
        },
      },
    },
    '/v1/colors': {
      get: {
        operationId: 'listColors',
        parameters: [{ in: 'header', name: 'cursor' }],
        responses: {
          '200': {
            content: { 'application/json': { schema: { $ref: '#/components/schemas/ThingPage' } } },
          },
        },
      },
    },
    '/v1/shapes': {
      get: {
        operationId: 'listShapes',
        parameters: [{ in: 'query', name: 'cursor' }],
        responses: {
          '200': {
            content: {
              'application/json': { schema: { type: 'object', properties: { items: {} } } },
            },
          },
        },
      },
    },
  },
  components: {
    parameters: { Cursor: { in: 'query', name: 'cursor' } },
    schemas: {
      ThingPage: { type: 'object', properties: { items: {}, nextCursor: {} } },
    },
  },
};

describe('INFINITE_OPERATIONS', () => {
  it('finds only GET operations with a cursor query and a nextCursor body', () => {
    expect(pagedGetOperations(FIXTURE_DOCUMENT)).toEqual(['listThings']);
  });

  it('is sorted', () => {
    expect([...INFINITE_OPERATIONS]).toEqual([...INFINITE_OPERATIONS].sort());
  });

  it('INFINITE_OPERATIONS equals the paged GET operations', async () => {
    expect([...INFINITE_OPERATIONS]).toEqual(pagedGetOperations(await committedDocument()));
  });
});
