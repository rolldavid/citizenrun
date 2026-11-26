import type { Me } from '@citizenrun/shared';

import { currentPath, navigateTo, onboardingHref } from '@/lib/navigation';

/** After a step's endpoint answered: go to the step Me names; 'done' is the guard's (row 10). */
export function goToNextStep(me: Me): void {
  const step = me.onboardingStep;
  if (step === 'done') {
    return;
  }
  const href = onboardingHref(step);
  if (href !== currentPath()) {
    navigateTo(href);
  }
}
