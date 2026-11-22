import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { ErrorEnvelopeSchema, pageSchema } from './common.ts';

describe('ErrorEnvelopeSchema', () => {
  it('the envelope accepts a registry code', () => {
    const result = ErrorEnvelopeSchema.safeParse({
      error: { code: 'not_found', message: 'Not found.', fields: {} },
    });
    expect(result.success).toBe(true);
  });

  it('the envelope refuses an unknown code', () => {
    const result = ErrorEnvelopeSchema.safeParse({
      error: { code: 'nope', message: 'Not found.', fields: {} },
    });
    expect(result.success).toBe(false);
  });

  it('the envelope keeps field codes', () => {
    const kept = ErrorEnvelopeSchema.safeParse({
      error: {
        code: 'invalid_request',
        message: 'The request is not valid.',
        fields: { 'issues.2.issueId': 'required' },
      },
    });
    expect(kept.success).toBe(true);
    expect(kept.data?.error.fields).toEqual({ 'issues.2.issueId': 'required' });

    const refused = ErrorEnvelopeSchema.safeParse({
      error: {
        code: 'invalid_request',
        message: 'The request is not valid.',
        fields: { a: 'weird' },
      },
    });
    expect(refused.success).toBe(false);
  });

  it('the envelope refuses a message over 200 characters', () => {
    const result = ErrorEnvelopeSchema.safeParse({
      error: { code: 'internal', message: 'x'.repeat(201), fields: {} },
    });
    expect(result.success).toBe(false);
  });
});

describe('pageSchema', () => {
  const TestPageSchema = pageSchema(z.string(), 'CommonTestStringPage');

  it('pageSchema keeps nextCursor nullable', () => {
    expect(TestPageSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    expect(TestPageSchema.safeParse({ items: ['a'], nextCursor: 'abc' }).success).toBe(true);
    expect(TestPageSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it('pageSchema refuses a cursor over 512 characters', () => {
    expect(TestPageSchema.safeParse({ items: [], nextCursor: 'c'.repeat(513) }).success).toBe(
      false,
    );
  });

  it('pageSchema gives the page its component id', () => {
    expect(z.globalRegistry.get(TestPageSchema)?.id).toBe('CommonTestStringPage');
  });
});
