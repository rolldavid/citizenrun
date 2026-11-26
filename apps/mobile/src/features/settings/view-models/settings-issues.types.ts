import type { ErrorCode } from '@citizenrun/shared';

import type { OnboardingIssuesData } from '@/features/onboarding';
import type { ViewState } from '@/lib/view-state';

// SCR-settings-issues
export type SettingsIssuesViewModel = ViewState<
  Omit<OnboardingIssuesData, 'submit'> & {
    submit: { status: 'idle' | 'sending' | 'saved'; errorCode: ErrorCode | null };
  }
>;
