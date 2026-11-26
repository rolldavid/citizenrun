import { useRef, useState } from 'react';

import { writeMeToCache } from '@/features/system';
import { useIsOnline } from '@/lib/view-models/query';
import { links } from '@/platform/links';
import { queryClient } from '@/platform/query-client';

import { attachAvatar, skipOnboardingStep } from '../data/onboarding-requests';

import { failureOfAttach } from './photo-steps';
import type { OnboardingPhotoViewModel } from './photo.types';
import { goToNextStep } from './step-navigation';
import { useAvatarPhoto } from './use-avatar-photo';

/** SCR-onboarding-photo: E-UPL-01, the bucket, then E-ME-02; or E-ME-10 { step: 'photo' }. */
export function useOnboardingPhotoViewModel(): OnboardingPhotoViewModel {
  const avatar = useAvatarPhoto();
  const offline = !useIsOnline();
  const [skipStatus, setSkipStatus] = useState<OnboardingPhotoViewModel['skipStatus']>('idle');
  const busy = useRef(false);
  const { photo } = avatar;

  const onContinue = (): void => {
    if (offline || busy.current) return;
    // PC6B-17: Continue needs a photo
    const hasPhoto =
      photo.status === 'ready' || (photo.status === 'failed' && photo.previewUri !== null);
    if (!hasPhoto) return;
    busy.current = true;
    void (async () => {
      const sent = await avatar.upload();
      if (!sent.ok) {
        busy.current = false;
        return;
      }
      const outcome = await attachAvatar(sent.key);
      busy.current = false;
      if (outcome.ok) {
        avatar.attached();
        writeMeToCache(queryClient.get(), outcome.value);
        goToNextStep(outcome.value);
        return;
      }
      avatar.fail(failureOfAttach(outcome.failure));
      if (outcome.failure.kind === 'api' && outcome.failure.code === 'upload_invalid') {
        avatar.attached();
      }
    })();
  };

  const onSkip = (): void => {
    if (offline || busy.current || photo.status === 'uploading') return;
    busy.current = true;
    setSkipStatus('sending');
    void skipOnboardingStep('photo').then((outcome) => {
      busy.current = false;
      setSkipStatus('idle');
      if (outcome.ok) {
        writeMeToCache(queryClient.get(), outcome.value);
        goToNextStep(outcome.value);
        return;
      }
      const isRateLimited =
        outcome.failure.kind === 'api' && outcome.failure.code === 'rate_limited';
      avatar.fail(isRateLimited ? 'rate_limited' : 'generic');
    });
  };

  const onOpenSettings = (): void => {
    void links.openAppSettings();
  };

  return {
    photo,
    skipStatus,
    offline,
    onChoose: avatar.choose,
    onContinue,
    onSkip,
    onOpenSettings,
  };
}
