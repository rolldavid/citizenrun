import { describe, expect, it } from 'vitest';

import { fixtureMe } from '@/lib/view-models/__fixtures__/common';

import { FIXTURE_ISSUES } from './__fixtures__/issues';
import { buildIssuesStep, issuesBody } from './issues.build';

function pick(issueId: string, starred = false): { issueId: string; starred: boolean } {
  return { issueId, starred };
}

describe('buildIssuesStep', () => {
  it('keeps the grid in sort order', () => {
    const shuffled = [...FIXTURE_ISSUES].reverse();
    const step = buildIssuesStep({ issues: shuffled, me: fixtureMe() });
    expect(step.issues.map((issue) => issue.sort)).toEqual(
      Array.from({ length: 19 }, (_, index) => index + 1),
    );
    expect(step.limits).toEqual({ min: 3, max: 10, maxStarred: 3 });
  });

  it('starts from the saved picks', () => {
    const saved = [pick('schools', true), pick('climate'), pick('transit')];
    expect(buildIssuesStep({ issues: FIXTURE_ISSUES, me: fixtureMe() }).initial).toEqual([]);
    expect(
      buildIssuesStep({ issues: FIXTURE_ISSUES, me: fixtureMe({ issues: saved }) }).initial,
    ).toEqual(saved);
  });
});

describe('issuesBody', () => {
  it('sends the picks in sort order', () => {
    expect(
      issuesBody([pick('schools', true), pick('rent-housing'), pick('climate')], FIXTURE_ISSUES),
    ).toEqual([pick('rent-housing'), pick('climate'), pick('schools', true)]);
  });

  it('refuses two and eleven picks and four stars', () => {
    expect(issuesBody([pick('schools'), pick('climate')], FIXTURE_ISSUES)).toBeNull();
    expect(
      issuesBody(
        FIXTURE_ISSUES.slice(0, 11).map((issue) => pick(issue.id)),
        FIXTURE_ISSUES,
      ),
    ).toBeNull();
    expect(
      issuesBody(
        FIXTURE_ISSUES.slice(0, 5).map((issue, index) => pick(issue.id, index < 4)),
        FIXTURE_ISSUES,
      ),
    ).toBeNull();
  });

  it('accepts three and ten picks with three stars', () => {
    const three = FIXTURE_ISSUES.slice(0, 3).map((issue) => pick(issue.id, true));
    expect(issuesBody(three, FIXTURE_ISSUES)).toEqual(three);
    const ten = FIXTURE_ISSUES.slice(0, 10).map((issue, index) => pick(issue.id, index < 3));
    expect(issuesBody([...ten].reverse(), FIXTURE_ISSUES)).toEqual(ten);
  });

  it('keeps one of a repeated issue', () => {
    expect(
      issuesBody(
        [pick('climate', true), pick('schools'), pick('climate'), pick('transit')],
        FIXTURE_ISSUES,
      ),
    ).toEqual([pick('climate', true), pick('schools'), pick('transit')]);
    expect(
      issuesBody([pick('climate'), pick('climate'), pick('schools')], FIXTURE_ISSUES),
    ).toBeNull();
  });

  it('the fixture issues are the nineteen of the issue list', () => {
    expect(new Set(FIXTURE_ISSUES.map((issue) => issue.id)).size).toBe(19);
    expect(FIXTURE_ISSUES.map((issue) => issue.sort)).toEqual(
      Array.from({ length: 19 }, (_, index) => index + 1),
    );
    expect(FIXTURE_ISSUES[0]?.id).toBe('rent-housing');
    expect(FIXTURE_ISSUES[18]?.id).toBe('foreign-wars');
    for (const issue of FIXTURE_ISSUES) {
      expect(issue.icon).toBe(issue.id);
    }
  });
});
