import { describe, expect, it } from 'vitest';

import * as zodLocales from './zod-locales';

// metro.config.cjs resolves zod's `locales` re-export to this module; scripts/metro-config.test.ts
// tests the redirect.
describe('the locales of zod in the app bundles', () => {
  it('exports English alone', () => {
    expect(Object.keys(zodLocales)).toEqual(['en']);
    expect(typeof zodLocales.en().localeError).toBe('function');
  });
});
