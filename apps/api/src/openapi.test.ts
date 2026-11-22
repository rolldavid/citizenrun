import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { buildOpenApiDocument, createDocDeps } from './openapi.ts';
import { OPENAPI_FILE } from './scripts/gen-openapi.ts';

type Operation = Record<string, unknown>;

function objectAt(value: unknown, ...keys: string[]): Record<string, unknown> {
  let current: unknown = value;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null || !(key in current)) {
      throw new Error(`missing ${keys.join('.')}`);
    }
    current = (current as Record<string, unknown>)[key]; // checked to be an object holding the key above
  }
  if (typeof current !== 'object' || current === null) {
    throw new Error(`${keys.join('.')} is not an object`);
  }
  return current as Record<string, unknown>; // checked to be a non-null object above
}

describe('buildOpenApiDocument', () => {
  it('the document is deterministic', () => {
    expect(JSON.stringify(buildOpenApiDocument())).toBe(JSON.stringify(buildOpenApiDocument()));
  });

  it('is an OpenAPI 3.1 document with the fixed info block', () => {
    const document = buildOpenApiDocument();
    expect(document['openapi']).toBe('3.1.0');
    expect(document['info']).toEqual({ title: 'API', version: '1' });
  });

  it('keys are sorted', () => {
    const document = buildOpenApiDocument();
    const paths = Object.keys(objectAt(document, 'paths'));
    const schemas = Object.keys(objectAt(document, 'components', 'schemas'));
    expect(paths).toEqual([...paths].sort());
    expect(schemas).toEqual([...schemas].sort());
    expect(schemas.length).toBeGreaterThan(1);
  });

  it('ErrorEnvelope is a named component', () => {
    const document = buildOpenApiDocument();
    expect(objectAt(document, 'components', 'schemas', 'ErrorEnvelope')).toMatchObject({
      type: 'object',
    });
    expect(
      objectAt(
        document,
        'paths',
        '/v1/openapi.json',
        'get',
        'responses',
        '429',
        'content',
        'application/json',
        'schema',
      ),
    ).toEqual({ $ref: '#/components/schemas/ErrorEnvelope' });
  });

  it('building reads no dependency', () => {
    expect(() => buildOpenApiDocument()).not.toThrow();
  });

  it('the document dependencies throw on any read', () => {
    const deps = createDocDeps();
    expect(() => deps.db).toThrow('deps.db was read while building the OpenAPI document');
    expect(() => deps.clock).toThrow('deps.clock was read while building the OpenAPI document');
  });

  it('E-REF-03 carries its metadata', () => {
    const document = buildOpenApiDocument();
    expect(Object.keys(objectAt(document, 'paths'))).toEqual(['/v1/openapi.json']);
    const operation: Operation = objectAt(document, 'paths', '/v1/openapi.json', 'get');
    expect(operation['operationId']).toBe('getOpenApiDocument');
    expect(operation['x-route']).toEqual({
      auth: 'none',
      rateLimit: 'ref.openapi',
      public: true,
      clientHeader: 'exempt',
    });
    expect(operation['x-errors']).toEqual(['rate_limited']);
    expect('security' in operation).toBe(false);
    expect(operation['tags']).toEqual(['reference']);
    expect(
      objectAt(operation, 'responses', '200', 'content', 'application/json', 'schema'),
    ).toEqual({ $ref: '#/components/schemas/OpenApiDocument' });
  });

  it('security schemes are declared', () => {
    const document = buildOpenApiDocument();
    expect(objectAt(document, 'components', 'securitySchemes')).toEqual({
      bearer: { type: 'http', scheme: 'bearer' },
      cookie: { type: 'apiKey', in: 'cookie', name: '__Host-os_session' },
    });
  });

  it('puts no machine path into the document', () => {
    const text = JSON.stringify(buildOpenApiDocument());
    expect(text).not.toContain(process.cwd());
  });

  it('the committed file is current', () => {
    const committed: unknown = JSON.parse(readFileSync(OPENAPI_FILE, 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
  });
});

describe('createApp', () => {
  it('serves the same document at /v1/openapi.json', async () => {
    const app = createApp(createDocDeps(), { strictResponses: true });
    const response = await app.request('/v1/openapi.json');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument())));
  });

  it('answers an unknown path with 404 not_found', async () => {
    const app = createApp(createDocDeps(), { strictResponses: true });
    const response = await app.request('/v1/nothing');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'Not found.', fields: {} },
    });
  });
});
