import { RESOURCES, isIssueId } from '@citizenrun/shared';

import type { StepT } from './step-translation';

type IssueKey = keyof (typeof RESOURCES)['en']['common']['issueShort'];

function isIssueKey(key: string): key is IssueKey {
  return Object.hasOwn(RESOURCES.en.common.issueShort, key);
}

/** 'data-centers-ai' -> 'dataCentersAi'. */
export function issueKeyOf(issueId: string): string {
  return issueId.replace(/-([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

/** The short name for a chip: the catalog's for a known id, else the issue's full name. */
export function issueShortName(issue: { id: string; name: string }, t: StepT): string {
  if (!isIssueId(issue.id)) {
    return issue.name;
  }
  const key = issueKeyOf(issue.id);
  return isIssueKey(key) ? t(`common:issueShort.${key}`) : issue.name;
}
