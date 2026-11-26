import type { ErrorCode, Issue } from '@citizenrun/shared';

import type { ViewState } from '@/lib/view-state';

/** SCR-onboarding-issues (CTL-77). */
export type OnboardingIssuesViewModel = ViewState<{
  issues: readonly Issue[]; // E-REF-01
  initial: readonly { issueId: string; starred: boolean }[]; // me.issues when the person came back; [] otherwise
  limits: { min: 3; max: 10; maxStarred: 3 }; // the shared constants
  submit: { status: 'idle' | 'sending'; errorCode: ErrorCode | null };
  onContinue: (picked: readonly { issueId: string; starred: boolean }[]) => void; // E-ME-09
  onBack: () => void;
}>;

export type OnboardingIssuesData = Extract<OnboardingIssuesViewModel, { status: 'ready' }>['data'];
