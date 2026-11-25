import { describe, expect, it } from 'vitest';
import { LIMITS } from './limits.ts';

describe('LIMITS', () => {
  it('the client error limit is 4,096 bytes', () => {
    expect(LIMITS.clientErrorBytes).toBe(4096);
  });

  it('LIMITS repeats no constant another contract owns', () => {
    expect(Object.keys(LIMITS)).toEqual(['clientErrorBytes']);
    for (const key of [
      'bioChars',
      'nameChars',
      'emailCodeAttempts',
      'exportsPerDay',
      'uploadPhotoBytes',
    ]) {
      expect(LIMITS).not.toHaveProperty(key);
    }
  });
});
