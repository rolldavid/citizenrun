import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { errorText } from '@/features/onboarding/components/error-text';
import { StepFrame } from '@/features/onboarding/components/step-frame';
import { STEP_NAMESPACES } from '@/features/onboarding/components/step-translation';
import { useTight } from '@/features/onboarding/components/use-tight';
import type { OnboardingLocationSoonViewModel } from '@/features/onboarding/view-models/location.types';
import { useOnboardingLocationViewModel } from '@/features/onboarding/view-models/use-onboarding-location-view-model';
import { head } from '@/platform/head';
import { EmptyChair } from '@/ui/components/empty-chair';

/**
 * SCR-onboarding-location: step 5 of sign-up, before districts can be set. It says what comes
 * next, and its one button moves on without asking where the person lives.
 */
export function OnboardingLocationScreenView({
  vm,
}: {
  vm: OnboardingLocationSoonViewModel;
}): JSX.Element {
  const { t } = useTranslation(STEP_NAMESPACES);
  const tight = useTight();
  return (
    <StepFrame
      step={5}
      onBack={vm.onBack}
      title={t('onboarding:location.titleSoon')}
      helper={t('onboarding:location.bodySoon')}
      offline={vm.offline}
      notice={vm.errorCode === null ? null : { text: errorText(vm.errorCode, t) }}
      footer={{
        primary: {
          label: t('onboarding:location.continue'),
          onPress: vm.onSkip,
          busy: vm.skipStatus === 'sending',
          testID: 'onboarding.location-skip',
        },
      }}
      testID="onboarding.location"
    >
      {/* On a tight layout the drawing gives its room to the words (PC6B-14). */}
      {tight ? null : <EmptyChair />}
    </StepFrame>
  );
}

export function OnboardingLocationScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'onboarding']);
  const vm = useOnboardingLocationViewModel();
  return (
    <>
      <head.Title>
        {t('common:documentTitle', { title: t('onboarding:location.titleSoon') })}
      </head.Title>
      <OnboardingLocationScreenView vm={vm} />
    </>
  );
}
