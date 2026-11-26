import { describe, expect, it } from 'vitest';

import { PlatformError } from '@/platform/shared';

import { iosUrlSchemeFor } from './google-config';

describe('iosUrlSchemeFor', () => {
  it('reverses the client id', () => {
    expect(iosUrlSchemeFor('123-abc.apps.googleusercontent.com')).toBe(
      'com.googleusercontent.apps.123-abc',
    );
    expect(iosUrlSchemeFor('000000000000-fixture.apps.googleusercontent.com')).toBe(
      'com.googleusercontent.apps.000000000000-fixture',
    );
  });

  it('refuses another shape', () => {
    for (const id of [
      '',
      '123-abc',
      '.apps.googleusercontent.com',
      '123-abc.apps.googleusercontent.com.example.test',
      '123.apps.googleusercontent.com.apps.googleusercontent.com',
      'com.googleusercontent.apps.123-abc',
    ]) {
      let thrown: unknown = null;
      try {
        iosUrlSchemeFor(id);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(PlatformError);
      expect(thrown).toMatchObject({ module: 'auth', code: 'auth.not_configured' });
    }
  });
});
