import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ResponseShapeError, respond } from './respond.ts';
import { createRouter } from './router.ts';

type Outcome = { response: Response; error: unknown };

// Answers one GET through `respond` in the given mode; an error thrown by the handler is captured.
async function answer(
  mode: 'strict' | 'strip',
  schema: z.ZodType,
  data: unknown,
  status?: 200 | 201 | 202,
): Promise<Outcome> {
  const router = createRouter();
  let error: unknown = null;
  router.use(async (c, next) => {
    c.set('respondMode', mode);
    await next();
  });
  router.get('/x', (c) => respond(c, schema, data, status));
  router.onError((err) => {
    error = err;
    return new Response(null, { status: 500 });
  });
  const response = await router.request('/x');
  return { response, error };
}

describe('respond', () => {
  it('strip mode drops unknown keys', async () => {
    const { response, error } = await answer('strip', z.object({ a: z.string() }), {
      a: 'x',
      secret: 'y',
    });
    expect(error).toBeNull();
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"a":"x"}');
  });

  it('strict mode throws naming the extra key', async () => {
    const { response, error } = await answer('strict', z.object({ a: z.string() }), {
      a: 'x',
      secret: 'y',
    });
    expect(response.status).toBe(500);
    expect(error).toBeInstanceOf(ResponseShapeError);
    const message = (error as ResponseShapeError).message; // checked to be a ResponseShapeError above
    expect(message).toContain('secret');
    expect(message).not.toContain('y');
    expect((error as ResponseShapeError).paths).toEqual(['secret']); // checked above
  });

  it('strict mode never puts a value in its message', async () => {
    const { error } = await answer('strict', z.object({ a: z.string() }), {
      a: 'x',
      token: 'MARKER_VALUE_7f3a',
    });
    expect(error).toBeInstanceOf(ResponseShapeError);
    expect((error as ResponseShapeError).message).not.toContain('MARKER_VALUE_7f3a'); // checked above
  });

  it('strict mode sees nested keys', async () => {
    const schema = z.object({ a: z.object({ b: z.number() }) });
    const { error } = await answer('strict', schema, { a: { b: 1, c: 2 } });
    expect(error).toBeInstanceOf(ResponseShapeError);
    expect((error as ResponseShapeError).paths).toEqual(['a.c']); // checked above
  });

  it('strict mode sees keys inside arrays', async () => {
    const schema = z.object({ items: z.array(z.object({ id: z.string() })) });
    const { error } = await answer('strict', schema, {
      items: [{ id: '1' }, { id: '2', hidden: 'z' }],
    });
    expect(error).toBeInstanceOf(ResponseShapeError);
    expect((error as ResponseShapeError).paths).toEqual(['items.1.hidden']); // checked above
  });

  it('strict mode passes data that matches its schema', async () => {
    const schema = z.object({ a: z.object({ b: z.number() }), c: z.string().nullable() });
    const { response, error } = await answer('strict', schema, { a: { b: 1 }, c: null });
    expect(error).toBeNull();
    expect(await response.json()).toEqual({ a: { b: 1 }, c: null });
  });

  it('a record schema passes every key', async () => {
    const schema = z.record(z.string(), z.unknown());
    const data = { openapi: '3.1.0', paths: { '/v1/x': { get: { operationId: 'x' } } } };
    const { response, error } = await answer('strict', schema, data);
    expect(error).toBeNull();
    expect(await response.json()).toEqual(data);
  });

  it('throws when the data does not parse', async () => {
    const { response, error } = await answer('strip', z.object({ a: z.string() }), { a: 1 });
    expect(response.status).toBe(500);
    expect(error).toBeInstanceOf(z.ZodError);
  });

  it('answers with the status it is given', async () => {
    const { response } = await answer('strip', z.object({ a: z.string() }), { a: 'x' }, 201);
    expect(response.status).toBe(201);
  });

  it('sets the JSON content type with its charset', async () => {
    const { response } = await answer('strip', z.object({ a: z.string() }), { a: 'x' });
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });
});
