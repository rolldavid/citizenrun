import { describe, expect, it } from 'vitest';

describe('@citizenrun/rules', () => {
  it('the entry loads', async () => {
    const entry: object = await import('./index.ts');
    expect(Object.keys(entry)).toEqual([]);
  });
});
