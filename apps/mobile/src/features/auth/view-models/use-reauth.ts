import type { SessionInfo } from '@citizenrun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';

import { useMe } from '@/features/system';

import { startSession } from '../data/session-start';

import type { ReauthViewModel } from './reauth.types';
import { useEmailCodeFlow } from './use-email-code-flow';
import { useProviders } from './use-providers';

const NO_METHODS: ReauthViewModel['methods'] = [];

export type Reauth = {
  vm: ReauthViewModel;
  /** Runs `action` now when `until` (Me.session.sensitiveActionsUntil) is in the future; else opens the sheet first. */
  run: (until: string | null, action: () => void) => void;
  /** Opens the sheet and runs `action` once after a successful sign-in (a 403 recent_sign_in_required). */
  openFor: (action: () => void) => void;
};

/** The re-authentication sheet (R-122): a sign-in with intent 'reauth'. */
export function useReauth(): Reauth {
  const { me } = useMe();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [providerNotice, setProviderNotice] = useState<ReauthViewModel['notice']>(null);
  const held = useRef<(() => void) | null>(null);

  const onVerified = (info: SessionInfo): void => {
    void (async () => {
      const started = await startSession(info, client);
      if (started === 'store_failed') {
        setProviderNotice({ code: 'generic', retryAfterSeconds: null });
        return;
      }
      const action = held.current;
      held.current = null;
      setOpen(false);
      action?.();
    })();
  };

  const flow = useEmailCodeFlow({ intent: 'reauth', onVerified });

  const providers = useProviders({
    intent: 'reauth',
    enabled: open,
    disabled: flow.email.status === 'sending',
    onStart: () => {
      setProviderNotice(null);
    },
    onEnded: () => undefined,
    onAttempt: (attempt) => {
      switch (attempt.kind) {
        case 'session':
          onVerified(attempt.info);
          return;
        case 'refused':
          setProviderNotice({ code: attempt.code, retryAfterSeconds: attempt.retryAfterSeconds });
          return;
        case 'signupRequired':
          return;
      }
    },
  });

  const openFor = (action: () => void): void => {
    held.current = action;
    flow.close();
    setProviderNotice(null);
    setOpen(true);
  };

  const run = (until: string | null, action: () => void): void => {
    if (until !== null && Date.parse(until) > Date.now()) {
      action();
      return;
    }
    openFor(action);
  };

  const methods =
    me === null
      ? NO_METHODS
      : me.signInMethods.filter((method) => method !== 'email' || me.email !== null);

  const notice: ReauthViewModel['notice'] =
    providerNotice ??
    (flow.refusal !== null
      ? { code: flow.refusal, retryAfterSeconds: null }
      : flow.email.errorCode !== null
        ? { code: flow.email.errorCode, retryAfterSeconds: flow.email.retryAfterSeconds }
        : null);

  return {
    vm: {
      open,
      methods,
      emailStatus: flow.email.status,
      onSendCode: () => {
        const email = me?.email ?? null;
        if (email === null) return;
        setProviderNotice(null);
        flow.sendTo(email);
      },
      onClose: () => {
        setOpen(false);
        held.current = null;
        flow.close();
      },
      providersBusy: providers.busy,
      appleButton: providers.appleButton,
      googleButton: providers.googleButton,
      notice,
      code: flow.code,
    },
    run,
    openFor,
  };
}
