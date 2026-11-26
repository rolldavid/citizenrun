import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { StepBar } from '@/features/onboarding/components/step-bar';
import type { OnboardingIssuesViewModel } from '@/features/onboarding/view-models/issues.types';
import { useOnboardingIssuesViewModel } from '@/features/onboarding/view-models/use-onboarding-issues-view-model';
import { head } from '@/platform/head';

import { IssuesStepView } from './issues-step-view';

/** SCR-onboarding-issues: step 4 of sign-up. Pick the issues the feed is ranked by. */
export function OnboardingIssuesScreenView({ vm }: { vm: OnboardingIssuesViewModel }): JSX.Element {
  const { t } = useTranslation(['onboarding']);
  const title = t('onboarding:issues.title');
  return (
    <IssuesStepView
      vm={vm}
      appBar={{
        variant: 'screen',
        title: null,
        // The way back comes with the issues.
        onBack: vm.status === 'ready' ? vm.data.onBack : null,
        center: <StepBar step={4} />,
      }}
      heading={title}
      groupLabel={title}
      helper={t('onboarding:issues.body')}
      primaryLabel={t('onboarding:issues.continue')}
      showChangeLater={true}
      testIDs={{
        screen: 'onboarding.issues',
        primary: 'onboarding.issues-continue',
        grid: 'onboarding.issue',
      }}
    />
  );
}

export function OnboardingIssuesScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'onboarding']);
  const vm = useOnboardingIssuesViewModel();
  return (
    <>
      <head.Title>{t('common:documentTitle', { title: t('onboarding:issues.title') })}</head.Title>
      <OnboardingIssuesScreenView vm={vm} />
    </>
  );
}
