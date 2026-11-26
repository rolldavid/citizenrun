import type { ErrorCode } from '@citizenrun/shared';
import { useRef, useState } from 'react';

import { writeMeToCache } from '@/features/system';
import { goBack } from '@/lib/navigation';
import { failureCode, useIsOnline } from '@/lib/view-models/query';
import { queryClient } from '@/platform/query-client';

import { skipOnboardingStep } from '../data/onboarding-requests';

import type { OnboardingLocationSoonViewModel } from './location.types';
import { goToNextStep } from './step-navigation';

/** SCR-onboarding-location, the skip-only form: E-ME-10 { step: 'location' } ends sign-up. */
export function useOnboardingLocationViewModel(): OnboardingLocationSoonViewModel {
  const offline = !useIsOnline();
  const [skipStatus, setSkipStatus] =
    useState<OnboardingLocationSoonViewModel['skipStatus']>('idle');
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null);
  const sending = useRef(false);

  const onSkip = (): void => {
    if (offline || sending.current) return;
    sending.current = true;
    setSkipStatus('sending');
    setErrorCode(null);
    void skipOnboardingStep('location').then((outcome) => {
      sending.current = false;
      setSkipStatus('idle');
      if (outcome.ok) {
        writeMeToCache(queryClient.get(), outcome.value);
        goToNextStep(outcome.value);
        return;
      }
      setErrorCode(failureCode(outcome.failure));
    });
  };

  const onBack = (): void => {
    goBack('/onboarding/issues');
  };

  return { skipStatus, errorCode, offline, onSkip, onBack };
}
