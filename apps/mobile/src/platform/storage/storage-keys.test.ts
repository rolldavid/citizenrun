import { describe, expect, expectTypeOf, it } from 'vitest';

import { ruleFor, STORAGE_KEY_PATTERNS, STORAGE_KEY_RULES } from './keys';
import type { StorageKey } from './types';

describe('storage keys', () => {
  it('the key union equals the allowed list', () => {
    expect([...STORAGE_KEY_PATTERNS].sort()).toEqual([
      'reload.chunkReloaded',
      'reload.upgradeReloaded',
      'theme',
    ]);
    expectTypeOf<StorageKey>().toEqualTypeOf<
      'theme' | 'reload.chunkReloaded' | 'reload.upgradeReloaded'
    >();
  });

  it('each key has its scope and is not user data', () => {
    expect(STORAGE_KEY_RULES.theme.scope).toBe('persistent');
    expect(STORAGE_KEY_RULES['reload.chunkReloaded'].scope).toBe('visit');
    expect(STORAGE_KEY_RULES['reload.upgradeReloaded'].scope).toBe('visit');
    for (const rule of Object.values(STORAGE_KEY_RULES)) {
      expect(rule.userData).toBe(false);
    }
  });

  it('values are checked', () => {
    const theme = STORAGE_KEY_RULES.theme;
    for (const choice of ['system', 'light', 'dark']) {
      expect(theme.isValid(choice)).toBe(true);
    }
    for (const value of ['sepia', null, 1]) {
      expect(theme.isValid(value)).toBe(false);
    }
    for (const key of ['reload.chunkReloaded', 'reload.upgradeReloaded'] as const) {
      const rule = STORAGE_KEY_RULES[key];
      expect(rule.isValid(true)).toBe(true);
      for (const value of [false, 'true', 1, null, undefined, {}]) {
        expect(rule.isValid(value)).toBe(false);
      }
    }
  });

  it('unknown names have no rule', () => {
    expect(ruleFor('token')).toBeNull();
    expect(ruleFor('draft:post')).toBeNull();
    expect(ruleFor('')).toBeNull();
    expect(ruleFor('toString')).toBeNull();
    expect(ruleFor('ageGate')).toBeNull();
    expect(ruleFor('theme')).toBe(STORAGE_KEY_RULES.theme);
    expect(ruleFor('ageGate.blockedUntil')).toBeNull();
  });
});
