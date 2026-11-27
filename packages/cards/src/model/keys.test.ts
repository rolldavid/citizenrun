import { describe, expect, it } from 'vitest';
import { camelKey } from './keys.ts';

describe('camelKey', () => {
  it('kebab to camel', () => {
    expect(camelKey('us-senate')).toBe('usSenate');
    expect(camelKey('data-centers-ai')).toBe('dataCentersAi');
    expect(camelKey('sheriff')).toBe('sheriff');
  });
});
