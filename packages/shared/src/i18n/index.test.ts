import { describe, expect, it } from 'vitest';
import { BRAND } from '../brand.ts';
import { ERROR_CODES } from '../errors.ts';
import type { ErrorCode } from '../errors.ts';
import { NAMESPACES, RESOURCES, createI18n } from './index.ts';

// Held in constants so the catalog check does not read them as catalog keys.
const PLURAL_NAMESPACE = 'pluralFixture';
const PLURAL_KEY = 'item';
const NOT_RESOLVED = 'fixture key not resolved';

describe('createI18n', () => {
  it('resolves the fixed phrases', () => {
    const { t } = createI18n();
    expect(t('notKnownYet')).toBe('not known yet');
    expect(t('about')).toBe('about');
    expect(t('aboutValue', { value: '12' })).toBe('about 12');
  });

  it('has a key for every error code', () => {
    const { t } = createI18n();
    const codes = Object.keys(ERROR_CODES) as ErrorCode[]; // the keys of an as-const object
    for (const code of codes) {
      const key = `errors:${code}` as const;
      const text = t(key);
      expect(typeof text).toBe('string');
      expect(text).not.toBe(key);
      expect(text).not.toBe(code);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('has the text of a failure that has no code', () => {
    const { t } = createI18n();
    expect(t('errors:generic')).toBe('Something went wrong. Try again.');
    // It blames no side: a failed request may never have reached the server.
    expect(t('errors:generic')).not.toBe(t('errors:internal'));
    expect(Object.keys(ERROR_CODES)).not.toContain('generic');
  });

  it("defaults appName to the brand's display name", () => {
    expect(createI18n().services.interpolator.interpolate('{{appName}}', {}, 'en', {})).toBe(
      BRAND.displayName,
    );
    expect(
      createI18n({ appName: 'Fixture App' }).services.interpolator.interpolate(
        '{{appName}}',
        {},
        'en',
        {},
      ),
    ).toBe('Fixture App');
  });

  it('plural keys resolve the same everywhere', () => {
    const instance = createI18n();
    instance.addResourceBundle('en', PLURAL_NAMESPACE, {
      [`${PLURAL_KEY}_one`]: '{{count}} item',
      [`${PLURAL_KEY}_other`]: '{{count}} items',
    });
    // A key outside the typed catalogs is accepted only with a default value, which shows if the
    // fixture key failed to resolve.
    const key: string = `${PLURAL_NAMESPACE}:${PLURAL_KEY}`;
    const results = [0, 1, 2].map((count) => instance.t(key, NOT_RESOLVED, { count }));
    expect(results).toEqual(['0 items', '1 item', '2 items']);
  });

  it('is ready on the line after it is created, in English', () => {
    const instance = createI18n();
    expect(instance.isInitialized).toBe(true);
    expect(instance.language).toBe('en');
    expect([...NAMESPACES]).toEqual(Object.keys(RESOURCES.en));
  });
});
