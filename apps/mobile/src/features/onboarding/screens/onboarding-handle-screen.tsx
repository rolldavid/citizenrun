import { assertNever, formatDate } from '@citizenrun/shared';
import { useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { errorText } from '@/features/onboarding/components/error-text';
import { localDateOf } from '@/features/onboarding/components/local-date';
import type { StepNotice } from '@/features/onboarding/components/step-footer';
import { StepFrame } from '@/features/onboarding/components/step-frame';
import { STEP_NAMESPACES } from '@/features/onboarding/components/step-translation';
import type { OnboardingHandleViewModel } from '@/features/onboarding/view-models/handle.types';
import { useOnboardingHandleViewModel } from '@/features/onboarding/view-models/use-onboarding-handle-view-model';
import { head } from '@/platform/head';
import { HandleField } from '@/ui/components/handle-field';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

const HELPER: ViewStyle = { marginTop: space.x2 };

/** SCR-onboarding-handle: step 3 of sign-up. Claim a handle. */
export function OnboardingHandleScreenView({ vm }: { vm: OnboardingHandleViewModel }): JSX.Element {
  const { t, i18n } = useTranslation(STEP_NAMESPACES);
  // What is typed stays here until Continue; the view-model hears each change.
  const [value, setValue] = useState(vm.initialHandle ?? '');

  /** What the check found, in the field's own line. */
  const statusText = (): string | null => {
    switch (vm.check) {
      case 'idle':
        return null;
      case 'checking':
        return t('common:ui.handle.checking');
      case 'free':
        return t('onboarding:handle.free');
      case 'taken':
        return t('onboarding:handle.taken');
      case 'reserved':
        return t('onboarding:handle.reserved');
      case 'failed':
        return t('onboarding:handle.checkFailed');
      case 'invalid':
        switch (vm.invalidReason) {
          case 'too_short':
            return t('onboarding:handle.tooShort');
          case 'too_long':
            return t('onboarding:handle.tooLong');
          case 'characters':
            return t('onboarding:handle.characters');
          case 'dots':
            return t('onboarding:handle.dots');
          case 'no_letter':
            return t('onboarding:handle.noLetter');
          case 'not_allowed':
          case null:
            return null;
          default:
            return assertNever(vm.invalidReason);
        }
      default:
        return assertNever(vm.check);
    }
  };

  const noticeOf = (): StepNotice | null => {
    const { errorCode, changeAvailableAt } = vm.submit;
    if (errorCode === null) {
      return null;
    }
    if (errorCode === 'handle_change_too_soon' && changeAvailableAt !== null) {
      // The day a new handle may be picked, as the device's own calendar has it.
      const day = localDateOf(changeAvailableAt);
      if (day !== null) {
        return {
          text: t('errors:handle_change_too_soon', {
            date: formatDate(day, i18n.language, 'long'),
          }),
        };
      }
    }
    return { text: errorText(errorCode, t) };
  };

  const unchanged = vm.initialHandle !== null && value === vm.initialHandle;
  // A check that failed leaves the answer to the server.
  const canContinue = vm.check === 'free' || vm.check === 'failed' || unchanged;

  return (
    <StepFrame
      step={3}
      onBack={vm.onBack}
      title={t('onboarding:handle.title')}
      helper={t('onboarding:handle.body')}
      offline={vm.offline}
      notice={noticeOf()}
      footer={{
        primary: {
          label: canContinue ? t('onboarding:handle.continue') : t('onboarding:handle.needHandle'),
          onPress: vm.onContinue,
          disabled: !canContinue,
          busy: vm.submit.status === 'sending',
          testID: 'onboarding.handle-continue',
        },
      }}
      testID="onboarding.handle"
    >
      <HandleField
        label={t('onboarding:handle.label')}
        value={value}
        onChangeText={(typed) => {
          setValue(typed);
          vm.onChange(typed);
        }}
        check={vm.check === 'failed' ? 'invalid' : vm.check}
        statusText={statusText()}
        testID="onboarding.handle-field"
      />
      <View style={HELPER}>
        <Text role="caption" tone="secondary">
          {t('onboarding:handle.helper')}
        </Text>
      </View>
    </StepFrame>
  );
}

export function OnboardingHandleScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'onboarding']);
  const vm = useOnboardingHandleViewModel();
  return (
    <>
      <head.Title>{t('common:documentTitle', { title: t('onboarding:handle.title') })}</head.Title>
      <OnboardingHandleScreenView vm={vm} />
    </>
  );
}
