import { ISSUES_MAX, ISSUES_MIN, STARRED_MAX } from '@citizenrun/shared';
import type { Issue, Me } from '@citizenrun/shared';

import type { OnboardingIssuesData } from './issues.types';

const LIMITS: OnboardingIssuesData['limits'] = {
  min: ISSUES_MIN,
  max: ISSUES_MAX,
  maxStarred: STARRED_MAX,
};

function bySort(issues: readonly Issue[]): Issue[] {
  return [...issues].sort((a, b) => a.sort - b.sort);
}

/** The grid in sort order, the saved picks to start from and the limits. */
export function buildIssuesStep(input: {
  issues: readonly Issue[];
  me: Me;
}): Pick<OnboardingIssuesData, 'issues' | 'initial' | 'limits'> {
  return { issues: bySort(input.issues), initial: input.me.issues, limits: LIMITS };
}

/** The E-ME-09 list in sort order, or null when the picks break 3 to 10 or more than 3 stars. */
export function issuesBody(
  picked: readonly { issueId: string; starred: boolean }[],
  issues: readonly Issue[],
): { issueId: string; starred: boolean }[] | null {
  const seen = new Set<string>();
  const unique: { issueId: string; starred: boolean }[] = [];
  for (const pick of picked) {
    if (seen.has(pick.issueId)) continue;
    seen.add(pick.issueId);
    unique.push({ issueId: pick.issueId, starred: pick.starred });
  }
  const starred = unique.filter((pick) => pick.starred).length;
  if (unique.length < ISSUES_MIN || unique.length > ISSUES_MAX || starred > STARRED_MAX) {
    return null;
  }
  // An id the list does not hold sorts last; E-ME-09 answers unknown_issue for it
  const sortOf = new Map(issues.map((issue) => [issue.id, issue.sort]));
  const rank = (id: string): number => sortOf.get(id) ?? Number.POSITIVE_INFINITY;
  return unique.sort((a, b) => rank(a.issueId) - rank(b.issueId));
}
