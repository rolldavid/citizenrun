import type { OnboardingIssuesViewModel } from './issues.types';
import { goToNextStep } from './step-navigation';
import { useIssuesEditor } from './use-issues-editor';

/** SCR-onboarding-issues. */
export function useOnboardingIssuesViewModel(): OnboardingIssuesViewModel {
  return useIssuesEditor({ onSaved: goToNextStep, backTo: '/onboarding/handle' });
}
