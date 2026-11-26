import { assertNever } from '@citizenrun/shared';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { PhotoControl } from '@/features/onboarding/components/photo-control';
import { photoFailureText } from '@/features/onboarding/components/photo-failure';
import type { StepNotice } from '@/features/onboarding/components/step-footer';
import { StepFrame } from '@/features/onboarding/components/step-frame';
import { STEP_NAMESPACES } from '@/features/onboarding/components/step-translation';
import type { OnboardingPhotoViewModel } from '@/features/onboarding/view-models/photo.types';
import { useOnboardingPhotoViewModel } from '@/features/onboarding/view-models/use-onboarding-photo-view-model';
import { head } from '@/platform/head';

type Photo = OnboardingPhotoViewModel['photo'];

/** Whether there is a photo to send: one that was picked and prepared. */
function hasPhoto(photo: Photo): boolean {
  switch (photo.status) {
    case 'none':
      return false;
    case 'ready':
    case 'uploading':
      return true;
    case 'failed':
      return photo.previewUri !== null;
    default:
      return assertNever(photo);
  }
}

/** SCR-onboarding-photo: step 2 of sign-up. Add a profile photo, or skip. */
export function OnboardingPhotoScreenView({ vm }: { vm: OnboardingPhotoViewModel }): JSX.Element {
  const { t } = useTranslation(STEP_NAMESPACES);
  const { photo } = vm;
  const ready = hasPhoto(photo);

  const noticeOf = (): StepNotice | null => {
    if (photo.status !== 'failed') {
      return null;
    }
    const text = photoFailureText(photo.failure, t);
    switch (photo.failure) {
      case 'photos_blocked':
        return {
          text,
          action: {
            label: t('common:device.openSettings'),
            onPress: vm.onOpenSettings,
            testID: 'onboarding.photo-settings',
          },
        };
      case 'upload_failed':
        return {
          text,
          action: {
            label: t('common:ui.retry'),
            onPress: vm.onContinue,
            testID: 'onboarding.photo-retry',
          },
        };
      case 'unsupported_format':
      case 'photo_too_large':
      case 'prepare_failed':
      case 'rate_limited':
      case 'generic':
        return { text };
      default:
        return assertNever(photo.failure);
    }
  };

  return (
    <StepFrame
      step={2}
      onBack={null}
      title={t('onboarding:photo.title')}
      helper={t('onboarding:photo.body')}
      offline={vm.offline}
      notice={noticeOf()}
      footer={{
        primary: {
          // A button that waits says what it waits for.
          label: ready ? t('onboarding:photo.continue') : t('onboarding:photo.needPhoto'),
          onPress: vm.onContinue,
          disabled: !ready || vm.skipStatus === 'sending',
          busy: photo.status === 'uploading',
          testID: 'onboarding.photo-continue',
        },
      }}
      testID="onboarding.photo"
    >
      <PhotoControl
        photo={photo}
        skipStatus={vm.skipStatus}
        onChoose={vm.onChoose}
        onSkip={vm.onSkip}
      />
    </StepFrame>
  );
}

export function OnboardingPhotoScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'onboarding']);
  const vm = useOnboardingPhotoViewModel();
  return (
    <>
      <head.Title>{t('common:documentTitle', { title: t('onboarding:photo.title') })}</head.Title>
      <OnboardingPhotoScreenView vm={vm} />
    </>
  );
}
