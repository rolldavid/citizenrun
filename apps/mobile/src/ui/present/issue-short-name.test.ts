import { ISSUE_IDS, createI18n } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import { issueShortName } from './issue-short-name';

// The typed t accepts catalog keys only; the function passes each key as a plain string.
const t = createI18n().getFixedT('en') as unknown as TFunction;

describe('issueShortName', () => {
  it('every issue has its short name', () => {
    const names = ISSUE_IDS.map((id) => issueShortName(id, t));
    for (const [index, name] of names.entries()) {
      const id = ISSUE_IDS[index] ?? '';
      expect(name, id).not.toBeNull();
      expect(name?.trim().length, id).toBeGreaterThan(0);
      // A key the catalog does not hold comes back as the key itself.
      expect(name, id).not.toContain('issueShort');
      expect(name, id).not.toContain(':');
    }
    // One name per issue.
    expect(new Set(names).size).toBe(ISSUE_IDS.length);
    expect(issueShortName('rent-housing', t)).toBe('Rent');
    expect(issueShortName('medicare-for-all', t)).toBe('Medicare for All');
  });

  it('an unknown id', () => {
    expect(issueShortName('zz-unknown', t)).toBeNull();
    expect(issueShortName('', t)).toBeNull();
  });
});
