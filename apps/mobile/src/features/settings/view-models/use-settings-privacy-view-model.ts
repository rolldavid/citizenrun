import type { ErrorCode, Me } from '@citizenrun/shared';
import { useRef, useState } from 'react';

import { recordAiScreening, useMe } from '@/features/system';
import { failureCode, useIsOnline, viewStateOf } from '@/lib/view-models/query';
import { queryClient } from '@/platform/query-client';

import type { SettingsPrivacyViewModel } from './settings-privacy.types';

/** SCR-settings-privacy: the AI-screening switch through E-ME-11 (CTL-77). */
export function useSettingsPrivacyViewModel(): SettingsPrivacyViewModel {
  const { me, source } = useMe();
  const online = useIsOnline();
  const [saving, setSaving] = useState<'aiScreening' | null>(null);
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null);
  const busy = useRef(false);

  // Not optimistic: the switch reads Me, which a success has already updated
  const onSetAiScreening = (granted: boolean): void => {
    if (!online || busy.current) return;
    busy.current = true;
    setSaving('aiScreening');
    setErrorCode(null);
    void recordAiScreening(granted, queryClient.get()).then((outcome) => {
      busy.current = false;
      setSaving(null);
      if (!outcome.ok) {
        setErrorCode(failureCode(outcome.failure));
      }
    });
  };

  const view = viewStateOf<Me | null>([source], () => me, online);
  if (view.status !== 'ready') {
    return view;
  }
  if (view.data === null) {
    return { status: 'loading' };
  }
  return {
    ...view,
    data: { me: view.data, saving, errorCode, onSetAiScreening },
  };
}
