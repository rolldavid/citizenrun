import { useRef, useState } from 'react';

import { readMeFromCache, useMe, writeMeToCache } from '@/features/system';
import { goBack } from '@/lib/navigation';
import { useIsOnline } from '@/lib/view-models/query';
import { queryClient } from '@/platform/query-client';

import { setHandle } from '../data/onboarding-requests';

import { setHandleRefusal } from './handle-check';
import type { OnboardingHandleViewModel } from './handle.types';
import { goToNextStep } from './step-navigation';
import { useHandleCheck } from './use-handle-check';

type Submit = OnboardingHandleViewModel['submit'];

const SUBMIT_IDLE: Submit = { status: 'idle', errorCode: null, changeAvailableAt: null };
const SUBMIT_SENDING: Submit = { status: 'sending', errorCode: null, changeAvailableAt: null };

/** SCR-onboarding-handle: the live check, then E-ME-08. */
export function useOnboardingHandleViewModel(): OnboardingHandleViewModel {
  const { me } = useMe();
  const offline = !useIsOnline();
  const initialHandle = me === null ? null : me.handle;
  const checker = useHandleCheck({ ownHandle: initialHandle });
  const [submit, setSubmit] = useState<Submit>(SUBMIT_IDLE);
  const touched = useRef(false);
  const sending = useRef(false);

  function valueToSend(): string | null {
    if ((checker.check === 'free' || checker.check === 'failed') && checker.handle !== null) {
      return checker.handle;
    }
    if (!touched.current && initialHandle !== null) {
      return initialHandle;
    }
    return null;
  }

  const onChange = (value: string): void => {
    touched.current = true;
    checker.onChange(value);
  };

  const onContinue = (): void => {
    if (offline || sending.current) return;
    const value = valueToSend();
    if (value === null) return;
    sending.current = true;
    setSubmit(SUBMIT_SENDING);
    void setHandle(value).then((outcome) => {
      sending.current = false;
      if (outcome.ok) {
        setSubmit(SUBMIT_IDLE);
        writeMeToCache(queryClient.get(), outcome.value);
        goToNextStep(outcome.value);
        return;
      }
      const refusal = setHandleRefusal(outcome.failure);
      if (refusal.kind === 'check') {
        setSubmit(SUBMIT_IDLE);
        checker.set(refusal.state);
        return;
      }
      const cached = readMeFromCache(queryClient.get());
      setSubmit({
        status: 'idle',
        errorCode: refusal.errorCode,
        changeAvailableAt:
          refusal.errorCode === 'handle_change_too_soon' && cached !== null
            ? cached.handleChangeAvailableAt
            : null,
      });
    });
  };

  const onBack = (): void => {
    goBack('/onboarding/photo');
  };

  return {
    initialHandle,
    check: checker.check,
    invalidReason: checker.invalidReason,
    submit,
    offline,
    onChange,
    onContinue,
    onBack,
  };
}
