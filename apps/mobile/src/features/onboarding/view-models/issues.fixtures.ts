import { noop } from '@/lib/view-models/__fixtures__/common';

import { FIXTURE_ISSUES } from './__fixtures__/issues';
import type { OnboardingIssuesData, OnboardingIssuesViewModel } from './issues.types';

type Picks = OnboardingIssuesData['initial'];

const SUBMIT_IDLE: OnboardingIssuesData['submit'] = { status: 'idle', errorCode: null };

function readyWith(
  initial: Picks,
  submit: OnboardingIssuesData['submit'] = SUBMIT_IDLE,
): OnboardingIssuesViewModel {
  return {
    status: 'ready',
    data: {
      issues: FIXTURE_ISSUES,
      initial,
      limits: { min: 3, max: 10, maxStarred: 3 },
      submit,
      onContinue: noop,
      onBack: noop,
    },
    refreshing: false,
    stale: false,
  };
}

// The reference picks: rent and schools starred
const FIVE: Picks = [
  { issueId: 'rent-housing', starred: true },
  { issueId: 'utility-bills', starred: false },
  { issueId: 'property-taxes', starred: false },
  { issueId: 'wages-workers', starred: false },
  { issueId: 'schools', starred: true },
];

export const issuesLoading = { status: 'loading' } satisfies OnboardingIssuesViewModel;

export const issuesError = {
  status: 'error',
  code: 'unavailable',
  onRetry: noop,
} satisfies OnboardingIssuesViewModel;

export const issuesOffline = {
  status: 'offline',
  onRetry: noop,
} satisfies OnboardingIssuesViewModel;

export const issuesNone = readyWith([]) satisfies OnboardingIssuesViewModel;

export const issuesTwo = readyWith([
  { issueId: 'rent-housing', starred: false },
  { issueId: 'schools', starred: false },
]) satisfies OnboardingIssuesViewModel;

export const issuesFive = readyWith(FIVE) satisfies OnboardingIssuesViewModel;

export const issuesTen = readyWith(
  FIXTURE_ISSUES.slice(0, 10).map((issue, index) => ({ issueId: issue.id, starred: index < 2 })),
) satisfies OnboardingIssuesViewModel;

export const issuesStarLimit = readyWith(
  FIVE.map((pick) => ({
    issueId: pick.issueId,
    starred: pick.starred || pick.issueId === 'utility-bills',
  })),
) satisfies OnboardingIssuesViewModel;

export const issuesSending = readyWith(FIVE, {
  status: 'sending',
  errorCode: null,
}) satisfies OnboardingIssuesViewModel;

export const issuesSubmitError = readyWith(FIVE, {
  status: 'idle',
  errorCode: 'unknown_issue',
}) satisfies OnboardingIssuesViewModel;

// Tightness is the window's and the text size's, not the data's
export const issuesTight = readyWith(FIVE) satisfies OnboardingIssuesViewModel;
