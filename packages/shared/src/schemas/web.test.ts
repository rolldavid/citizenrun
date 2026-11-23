import { describe, expect, it } from 'vitest';
import { HealthzResponseSchema, ReadyzResponseSchema } from './web.ts';

describe('web schemas', () => {
  it('liveness answers only ok', () => {
    expect(HealthzResponseSchema.safeParse({ status: 'ok' }).success).toBe(true);
    expect(HealthzResponseSchema.safeParse({ status: 'down' }).success).toBe(false);
  });

  it('readiness values are closed sets', () => {
    expect(ReadyzResponseSchema.safeParse({ db: 'ok', worker: 'stale' }).success).toBe(true);
    expect(ReadyzResponseSchema.safeParse({ db: 'down', worker: 'unknown' }).success).toBe(true);
    expect(ReadyzResponseSchema.safeParse({ db: 'up', worker: 'ok' }).success).toBe(false);
    expect(ReadyzResponseSchema.safeParse({ db: 'ok', worker: 'dead' }).success).toBe(false);
  });
});
