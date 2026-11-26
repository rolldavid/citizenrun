import type { ErrorCode, Me } from '@citizenrun/shared';
import { useEffect, useRef, useState } from 'react';

import { useReauth } from '@/features/auth';
import { readMeFromCache, useMe } from '@/features/system';
import { clearRememberedNext, replaceWith } from '@/lib/navigation';
import { setSessionPresence } from '@/lib/session-state';
import { failureCode, useIsOnline, viewStateOf } from '@/lib/view-models/query';
import type { ViewState } from '@/lib/view-state';
import { queryClient } from '@/platform/query-client';
import { session } from '@/platform/session';

import { deleteAccount } from '../data/delete-requests';

import type { SettingsDeleteViewModel } from './settings-delete-account.types';

type Status = 'idle' | 'confirming' | 'deleting' | 'deleted';

const EXPORT_HREF = '/settings/export';

/** SCR-settings-delete-account: E-ME-03 behind the re-authentication sheet (CTL-35; D-570). */
export function useSettingsDeleteAccountViewModel(): SettingsDeleteViewModel {
  const { me, source } = useMe();
  const online = useIsOnline();
  const reauth = useReauth();
  const [status, setStatus] = useState<Status>('idle');
  const [errorCode, setErrorCode] = useState<ErrorCode | null>(null);
  // The Me shown once deleted: ending the session empties the query cache
  const [keptMe, setKeptMe] = useState<Me | null>(null);
  const busy = useRef(false);
  const ended = useRef(false);
  const { openFor } = reauth;

  const doDelete = (): void => {
    if (busy.current) return;
    busy.current = true;
    setStatus('deleting');
    setErrorCode(null);
    void deleteAccount().then((outcome) => {
      if (outcome.ok) {
        setKeptMe(readMeFromCache(queryClient.get()));
        setStatus('deleted');
        return;
      }
      busy.current = false;
      const code = failureCode(outcome.failure);
      if (code === 'recent_sign_in_required') {
        setStatus('confirming');
        openFor(doDelete);
        return;
      }
      setStatus('idle');
      setErrorCode(code);
    });
  };

  // D-570: the screen shows 'deleted' first, then the session ends, then the app leaves
  useEffect(() => {
    if (status !== 'deleted' || ended.current) return;
    ended.current = true;
    void (async () => {
      setSessionPresence('absent');
      clearRememberedNext();
      await session.endLocal('account_deleted');
      replaceWith('/');
    })();
  }, [status]);

  const onAskDelete = (): void => {
    if (busy.current) return;
    setStatus('confirming');
    setErrorCode(null);
  };

  const onCancel = (): void => {
    if (busy.current) return;
    setStatus('idle');
  };

  const onConfirm = (): void => {
    if (!online || busy.current || me === null) return;
    reauth.run(me.session.sensitiveActionsUntil, doDelete);
  };

  const live = viewStateOf<Me | null>([source], () => me, online);
  const view: ViewState<Me | null> =
    status === 'deleted' && keptMe !== null
      ? { status: 'ready', data: keptMe, refreshing: false, stale: false }
      : live;
  if (view.status !== 'ready') {
    return view;
  }
  if (view.data === null) {
    return { status: 'loading' };
  }
  return {
    ...view,
    data: {
      me: view.data,
      status,
      errorCode,
      reauth: reauth.vm,
      exportHref: EXPORT_HREF,
      onAskDelete,
      onConfirm,
      onCancel,
    },
  };
}
