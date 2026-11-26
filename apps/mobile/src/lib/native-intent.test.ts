import { describe, expect, it } from 'vitest';

import { rewriteSystemPath } from './native-intent';

describe('rewriteSystemPath', () => {
  it('Apple return paths go to sign-in', () => {
    for (const path of [
      '/auth/apple',
      '/auth/apple?code=x&state=y',
      'fixture-scheme://auth/apple?code=x',
      'fixture-scheme://auth/apple',
      'fixture-scheme:///auth/apple?error=cancelled',
    ]) {
      expect(rewriteSystemPath(path)).toBe('/sign-in');
    }
  });

  it('other paths are unchanged', () => {
    for (const path of [
      '/settings',
      'fixture-scheme://office/x',
      '/authority',
      '/auth/applesauce',
      'fixture-scheme://auth/applesauce',
      'https://example.test/auth/apple',
      '',
      '%%%',
    ]) {
      expect(() => rewriteSystemPath(path)).not.toThrow();
      expect(rewriteSystemPath(path)).toBe(path);
    }
  });
});
