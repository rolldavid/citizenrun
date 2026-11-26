import { logout as postLogout } from '@citizenrun/shared/api';
import { useCallback, useEffect, useRef, useState } from 'react';

import { clearRememberedNext, replaceWith } from '@/lib/navigation';
import { setSessionPresence } from '@/lib/session-state';
import { attempt } from '@/lib/view-models/query';
import { session } from '@/platform/session';

export const LOGOUT_TIMEOUT_MS = 5_000; // PC6C-15

/** E-AUTH-09, then the local session end whatever the answer (PM-session-tokens; CTL-11). */
export async function logout(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, LOGOUT_TIMEOUT_MS);
  await attempt(() => postLogout({}, { signal: controller.signal }));
  clearTimeout(timer);
  setSessionPresence('absent');
  clearRememberedNext();
  await session.endLocal('logout');
}

/** SCR-settings onLogout. */
export function useLogout(): { status: 'idle' | 'sending'; run: () => void } {
  const [status, setStatus] = useState<'idle' | 'sending'>('idle');
  const sending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(() => {
    if (sending.current) return;
    sending.current = true;
    setStatus('sending');
    void (async () => {
      await logout();
      replaceWith('/');
      sending.current = false;
      if (mounted.current) setStatus('idle');
    })();
  }, []);

  return { status, run };
}
