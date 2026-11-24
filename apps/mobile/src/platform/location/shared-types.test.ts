import { describe, expect, it } from 'vitest';

import { PlatformError, PlatformNotReadyError, fromExpoPermission } from '@/platform/shared';
import type { PlatformModuleName } from '@/platform/shared';

const MODULE_NAMES: readonly PlatformModuleName[] = [
  'session',
  'map',
  'upload',
  'push',
  'share',
  'location',
  'haptics',
  'calendar',
  'auth',
  'pdf',
  'video',
  'storage',
  'links',
  'age_assurance',
  'query_client',
];

// E-SAFE-02's `code` pattern.
const CLIENT_ERROR_CODE = /^[a-z][a-z0-9_.]{0,63}$/;

describe('shared platform types', () => {
  it('PlatformError carries its module and static code', () => {
    const error = new PlatformError('location', 'location.timeout');

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PlatformError');
    expect(error.module).toBe('location');
    expect(error.code).toBe('location.timeout');
    expect(error.message).toBe('location.timeout');
  });

  it('PlatformNotReadyError names the module and the member', () => {
    const error = new PlatformNotReadyError('push', 'register');

    expect(error).toBeInstanceOf(PlatformError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PlatformNotReadyError');
    expect(error.module).toBe('push');
    expect(error.code).toBe('push.not_ready');
    expect(error.method).toBe('register');
    expect(error.message).toBe('push.not_ready');
  });

  it('not-ready codes fit the client error pattern', () => {
    expect(new Set(MODULE_NAMES).size).toBe(15);
    for (const name of MODULE_NAMES) {
      const error = new PlatformNotReadyError(name, 'member');
      expect(error.code).toBe(`${name}.not_ready`);
      expect(error.code).toMatch(CLIENT_ERROR_CODE);
    }
  });

  it('fromExpoPermission maps every Expo answer', () => {
    expect(fromExpoPermission({ status: 'granted', canAskAgain: true }, false)).toBe('granted');
    expect(fromExpoPermission({ status: 'granted', canAskAgain: true }, true)).toBe('limited');
    expect(fromExpoPermission({ status: 'undetermined', canAskAgain: true }, false)).toBe(
      'undetermined',
    );
    expect(fromExpoPermission({ status: 'denied', canAskAgain: true }, false)).toBe('denied');
    expect(fromExpoPermission({ status: 'denied', canAskAgain: false }, false)).toBe('blocked');
  });
});
