import { HANDLE_MAX } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import { sanitizeHandleInput } from './handle-field-input';

describe('sanitizeHandleInput', () => {
  it('sanitizes', () => {
    expect(sanitizeHandleInput('@Jane-Doe!')).toBe('janedoe');
    expect(sanitizeHandleInput('JANE_doe.27')).toBe('jane_doe.27');
    const long = 'abcdefghijklmnopqrstuvwxyz0123';
    expect(long).toHaveLength(30);
    expect(sanitizeHandleInput(long)).toBe(long.slice(0, 20));
    expect(HANDLE_MAX).toBe(20);
  });

  it('drops one leading @ and every other one with the rest it does not keep', () => {
    expect(sanitizeHandleInput('@jane')).toBe('jane');
    expect(sanitizeHandleInput('@@jane')).toBe('jane');
    expect(sanitizeHandleInput('ja@ne')).toBe('jane');
    expect(sanitizeHandleInput('@')).toBe('');
    expect(sanitizeHandleInput('')).toBe('');
  });

  it('keeps letters, digits, dots and underscores and nothing else', () => {
    expect(sanitizeHandleInput('a b\tc')).toBe('abc');
    expect(sanitizeHandleInput('jané')).toBe('jan');
    expect(sanitizeHandleInput('j.a_n.e-2')).toBe('j.a_n.e2');
    expect(sanitizeHandleInput('ÀB')).toBe('b');
  });

  it('cuts to the longest handle after the characters it drops are gone', () => {
    const spaced = `@${'a b '.repeat(15)}`;
    expect(sanitizeHandleInput(spaced)).toBe('ab'.repeat(10));
  });
});
