import { describe, expect, it } from 'vitest';

type Module = Record<string, unknown>;

/**
 * Loads a generated module by a computed path. The generated folder is left out of this package's
 * typecheck (its imports follow the app's bundler resolution), so a static import would pull it in.
 */
async function load(relative: string): Promise<Module> {
  const url = new URL(relative, import.meta.url).href;
  return (await import(url)) as Module;
}

describe('generated client', () => {
  it('builds an operation that is not GET as a mutation, never as a query', async () => {
    const safety = await load('../api/safety/safety.ts');
    expect(safety).not.toHaveProperty('getCreateClientErrorQueryKey');
    expect(safety).not.toHaveProperty('getCreateClientErrorQueryOptions');
    expect(typeof safety['getCreateClientErrorMutationOptions']).toBe('function');
    expect(typeof safety['useCreateClientError']).toBe('function');
    expect(typeof safety['createClientError']).toBe('function');
  });

  it('keeps the query key, query options and hook of each GET operation', async () => {
    const reference = await load('../api/reference/reference.ts');
    const queryKey = reference['getGetOpenApiDocumentQueryKey'];
    expect(typeof queryKey).toBe('function');
    expect((queryKey as () => unknown)()).toEqual(['/v1/openapi.json']);
    expect(typeof reference['getGetOpenApiDocumentQueryOptions']).toBe('function');
    expect(typeof reference['useGetOpenApiDocument']).toBe('function');

    const web = await load('../api/web/web.ts');
    for (const name of ['Healthz', 'Readyz']) {
      expect(typeof web[`getGet${name}QueryKey`]).toBe('function');
      expect(typeof web[`getGet${name}QueryOptions`]).toBe('function');
      expect(typeof web[`useGet${name}`]).toBe('function');
    }
  });
});
