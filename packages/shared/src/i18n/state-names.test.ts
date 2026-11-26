import { describe, expect, it } from 'vitest';
import { STATE_CODES } from '../constants/geo.ts';
import { DYNAMIC_KEYS } from './dynamic-keys.ts';
import { common } from './en/common.ts';

describe('state names', () => {
  it('one name per state code', () => {
    const named: Readonly<Record<string, string>> = common.state;
    const codes = STATE_CODES.map((code) => code.toLowerCase());
    expect(codes).toHaveLength(56);
    expect(new Set(Object.keys(named))).toEqual(new Set(codes));
    for (const code of codes) {
      expect((named[code] ?? '').trim(), code).not.toBe('');
    }
  });

  it('every name is counted as read by a computed key', () => {
    const listed = new Set(DYNAMIC_KEYS.map((entry) => entry.key));
    for (const code of STATE_CODES) {
      expect(listed.has(`common:state.${code.toLowerCase()}`), code).toBe(true);
    }
  });
});
