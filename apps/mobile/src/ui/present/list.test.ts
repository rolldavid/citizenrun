import { createI18n } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import { formatList } from './list';

// The typed t accepts catalog keys only; the formatter passes each key as a plain string.
const t = createI18n().getFixedT('en') as unknown as TFunction;

describe('formatList', () => {
  it('zero, one, two, three and four items', () => {
    expect(formatList([], t)).toBe('');
    expect(formatList(['Pay'], t)).toBe('Pay');
    expect(formatList(['Pay', 'Hours'], t)).toBe('Pay and Hours');
    expect(formatList(['Pay', 'Hours', 'Benefits'], t)).toBe('Pay, Hours, and Benefits');
    expect(formatList(['Pay', 'Hours', 'Benefits', 'Term'], t)).toBe(
      'Pay, Hours, Benefits, and Term',
    );
  });

  it('joins through the catalog patterns alone', () => {
    const calls: string[] = [];
    const spy: TFunction = (key, vars) => {
      calls.push(key);
      return t(key, vars);
    };
    expect(formatList(['Pay', 'filing fee', 'where to file'], spy)).toBe(
      'Pay, filing fee, and where to file',
    );
    expect(calls).toEqual(['common:list.joiner', 'common:list.series']);
  });
});
