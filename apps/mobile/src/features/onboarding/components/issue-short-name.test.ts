import { ISSUE_IDS, createI18n } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import { issueKeyOf, issueShortName } from './issue-short-name';
import { STEP_NAMESPACES } from './step-translation';

const t = createI18n().getFixedT('en', STEP_NAMESPACES);

describe('issueKeyOf', () => {
  it('turns an issue id into its camelCase key', () => {
    expect(issueKeyOf('data-centers-ai')).toBe('dataCentersAi');
    expect(issueKeyOf('medicare-for-all')).toBe('medicareForAll');
    expect(issueKeyOf('climate')).toBe('climate');
  });
});

describe('issueShortName', () => {
  it('gives a known issue its short name', () => {
    expect(issueShortName({ id: 'wages-workers', name: 'Wages and worker power' }, t)).toBe(
      'Wages',
    );
    expect(issueShortName({ id: 'data-centers-ai', name: 'Data centers and AI' }, t)).toBe(
      'Data centers',
    );
  });

  it('gives an issue this build does not know its full name', () => {
    expect(issueShortName({ id: 'fixture-new-issue', name: 'Fixture issue name' }, t)).toBe(
      'Fixture issue name',
    );
  });

  it('has a short name for every issue of the list', () => {
    const marker = 'Fixture full name';
    const names = ISSUE_IDS.map((id) => issueShortName({ id, name: marker }, t));
    expect(names.filter((name) => name === marker || name.includes('issueShort'))).toEqual([]);
    expect(new Set(names).size).toBe(ISSUE_IDS.length);
  });
});
