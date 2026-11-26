import type { SessionInfo } from '@citizenrun/shared';
import { useEffect, useRef } from 'react';

import { useEmailCodeFlow } from '@/features/auth';
import { useMe, writeMeToCache } from '@/features/system';
import { useIsOnline, viewStateOf } from '@/lib/view-models/query';
import { queryClient } from '@/platform/query-client';

import type { SettingsAccountViewModel } from './settings-account.types';

type AccountData = Extract<SettingsAccountViewModel, { status: 'ready' }>['data'];

/** SCR-settings-account: E-ME-01; E-AUTH-01 and E-AUTH-02 with intent add_email (D-245). */
export function useSettingsAccountViewModel(): SettingsAccountViewModel {
  const { me, source } = useMe();
  const online = useIsOnline();
  const closeFlow = useRef<(() => void) | null>(null);

  // The session is unchanged: info.token is null
  const onVerified = (info: SessionInfo): void => {
    writeMeToCache(queryClient.get(), info.me);
    closeFlow.current?.();
  };

  const flow = useEmailCodeFlow({ intent: 'add_email', onVerified });

  useEffect(() => {
    closeFlow.current = flow.close;
  });

  // Another device added an email meanwhile
  const { refusal, close } = flow;
  const refetchMe = source.refetch;
  useEffect(() => {
    if (refusal !== 'email_already_set') return;
    close();
    void refetchMe();
  }, [refusal, close, refetchMe]);

  const view = viewStateOf<AccountData | null>(
    [source],
    () =>
      me === null
        ? null
        : {
            me,
            addEmail: { stage: flow.stage, email: flow.email, code: flow.code },
            onOpenAddEmail: flow.open,
            onCloseAddEmail: flow.close,
          },
    online,
  );
  if (view.status !== 'ready') {
    return view;
  }
  if (view.data === null) {
    return { status: 'loading' };
  }
  return { ...view, data: view.data };
}
