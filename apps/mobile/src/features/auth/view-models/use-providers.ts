import { ERROR_CODES } from '@citizenrun/shared';
import type { ErrorCode, NonceResult, SessionInfo } from '@citizenrun/shared';
import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';

import { failureCode, subscribeAppFocus, useIsOnline } from '@/lib/view-models/query';
import type { Outcome } from '@/lib/view-models/query';
import { auth } from '@/platform/auth';
import type {
  AppleCallbackError,
  AppleSignInButtonProps,
  AppleSignInResult,
  AuthFailureCode,
  GoogleSignInButtonProps,
  GoogleSignInResult,
  ProviderAvailability,
} from '@/platform/auth';

import {
  postAppleHandoff,
  postAppleToken,
  postGoogleToken,
  requestNonce,
} from '../data/sign-in-requests';
import type { SignInIntent } from '../data/sign-in-requests';

import { createBoundButton } from './bound-button';
import type { BoundButton, ScreenButtonProps } from './bound-button';
import type { PendingCredential } from './sign-in.machine';

export const PROVIDER_BUSY_LIMIT_MS = 30_000; // PC6B-16

export type ProviderAttempt =
  | { kind: 'session'; info: SessionInfo }
  | { kind: 'signupRequired'; pending: PendingCredential }
  | {
      kind: 'refused';
      code: ErrorCode | 'provider_unavailable' | 'generic';
      retryAfterSeconds: number | null;
    };

type ProvidersOptions = {
  intent: SignInIntent;
  enabled: boolean;
  disabled: boolean;
  onStart: () => void;
  onEnded: () => void;
  onAttempt: (attempt: ProviderAttempt) => void;
};

const NO_PROVIDERS: ProviderAvailability = { apple: false, google: false };

function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_CODES, value);
}

// PM-auth "Failure modes"; a reason the catalog of error codes does not hold yet reads as 'generic'.
function appleRefusal(reason: AppleCallbackError): ErrorCode | 'generic' {
  if (reason === 'state_invalid' || reason === 'token_invalid') return 'identity_token_invalid';
  return isErrorCode(reason) ? reason : 'generic';
}

function failedCode(code: AuthFailureCode): 'provider_unavailable' | 'generic' {
  return code === 'auth.not_configured' || code === 'auth.unavailable'
    ? 'provider_unavailable'
    : 'generic';
}

function refused(code: Extract<ProviderAttempt, { kind: 'refused' }>['code']): ProviderAttempt {
  return { kind: 'refused', code, retryAfterSeconds: null };
}

type Controller = {
  apple: BoundButton<AppleSignInButtonProps>;
  google: BoundButton<GoogleSignInButtonProps>;
  setOptions: (next: ProvidersOptions) => void;
  setDisabled: (value: boolean) => void;
  prepare: () => Promise<ProviderAvailability>;
  /** Starts the nonce lifecycle; answers its stop. */
  enable: () => () => void;
  onlineReturned: () => void;
};

/** One instance per hook: the nonce, its hash and state stay inside it and in the bindings (SCR-sign-in rule 9). */
function createController(
  initial: ProvidersOptions,
  setBusyState: (busy: boolean) => void,
): Controller {
  let options = initial;
  let enabled = false;
  let disabled = initial.disabled;
  let busy = false;
  let nonce: NonceResult | null = null;
  let boundHash: string | null = null;
  let boundState = '';
  let asking = false;
  let attemptNonce: string | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let limitTimer: ReturnType<typeof setTimeout> | null = null;
  let preparing: Promise<ProviderAvailability> | null = null;

  const apple = createBoundButton(auth.AppleSignInButton);
  const google = createBoundButton(auth.GoogleSignInButton);

  function clearExpiry(): void {
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = null;
  }

  function clearLimit(): void {
    if (limitTimer !== null) clearTimeout(limitTimer);
    limitTimer = null;
  }

  function rebind(): void {
    if (nonce !== null) {
      boundHash = nonce.nonceHash;
      boundState = nonce.state;
    }
    if (boundHash === null) return;
    const off = busy || disabled || nonce === null;
    apple.bind({
      nonceHash: boundHash,
      state: boundState,
      disabled: off,
      onStart: start,
      onResult: onAppleResult,
    });
    google.bind({ nonceHash: boundHash, disabled: off, onStart: start, onResult: onGoogleResult });
  }

  // E-AUTH-03: one request at a time, never during an attempt.
  // Read through a call: the answer changes while a request is in flight.
  function canAsk(): boolean {
    return enabled && !busy;
  }

  async function ask(): Promise<void> {
    if (asking || !canAsk()) return;
    asking = true;
    const outcome = await requestNonce();
    asking = false;
    if (!canAsk()) return;
    clearExpiry();
    if (outcome.ok) {
      nonce = outcome.value;
      const wait = Math.max(0, Date.parse(outcome.value.expiresAt) - Date.now());
      expiryTimer = setTimeout(() => {
        void ask();
      }, wait);
    } else {
      nonce = null;
    }
    rebind();
  }

  function setBusy(value: boolean): void {
    busy = value;
    setBusyState(value);
  }

  function start(): void {
    if (busy || nonce === null) return;
    attemptNonce = nonce.nonce;
    setBusy(true);
    options.onStart();
    limitTimer = setTimeout(() => {
      end(null);
    }, PROVIDER_BUSY_LIMIT_MS);
    rebind();
  }

  function end(attempt: ProviderAttempt | null): void {
    clearLimit();
    attemptNonce = null;
    setBusy(false);
    nonce = null;
    if (attempt !== null) options.onAttempt(attempt);
    options.onEnded();
    rebind();
    void ask();
  }

  /** The raw nonce of the open attempt, taken once; null when no attempt is open. */
  function takeAttempt(): string | null {
    const taken = attemptNonce;
    attemptNonce = null;
    clearLimit();
    return taken;
  }

  async function post(
    intent: SignInIntent,
    call: Promise<Outcome<SessionInfo>>,
    pending: PendingCredential,
  ): Promise<void> {
    const outcome = await call;
    if (outcome.ok) {
      end({ kind: 'session', info: outcome.value });
      return;
    }
    const { failure } = outcome;
    if (
      intent === 'sign_in' &&
      failure.kind === 'api' &&
      failure.code === 'signup_details_required'
    ) {
      end({ kind: 'signupRequired', pending });
      return;
    }
    end({
      kind: 'refused',
      code: failureCode(failure),
      retryAfterSeconds: failure.kind === 'api' ? failure.retryAfterSeconds : null,
    });
  }

  function onAppleResult(result: AppleSignInResult): void {
    const raw = takeAttempt();
    if (raw === null) return;
    const { intent } = options;
    switch (result.kind) {
      case 'token': {
        const { idToken, code, name } = result;
        void post(
          intent,
          postAppleToken({ idToken, code, nonce: raw, intent, ...(name !== null ? { name } : {}) }),
          { kind: 'apple', idToken, code, nonce: raw, name },
        );
        return;
      }
      case 'handoff':
        void post(intent, postAppleHandoff({ code: result.code, nonce: raw, intent }), {
          kind: 'apple_handoff',
          code: result.code,
          nonce: raw,
        });
        return;
      case 'server_refused':
        end(refused(appleRefusal(result.reason)));
        return;
      case 'cancelled':
        end(null);
        return;
      case 'failed':
        end(refused(failedCode(result.code)));
        return;
    }
  }

  function onGoogleResult(result: GoogleSignInResult): void {
    const raw = takeAttempt();
    if (raw === null) return;
    const { intent } = options;
    switch (result.kind) {
      case 'token':
        void post(intent, postGoogleToken({ idToken: result.idToken, nonce: raw, intent }), {
          kind: 'google',
          idToken: result.idToken,
          nonce: raw,
        });
        return;
      case 'cancelled':
        end(null);
        return;
      case 'failed':
        end(refused(failedCode(result.code)));
        return;
    }
  }

  return {
    apple,
    google,
    setOptions: (next) => {
      options = next;
    },
    setDisabled: (value) => {
      if (value === disabled) return;
      disabled = value;
      rebind();
    },
    prepare: () => {
      preparing ??= Promise.resolve()
        .then(() => auth.prepare())
        .catch(() => NO_PROVIDERS);
      return preparing;
    },
    enable: () => {
      enabled = true;
      void ask();
      const stopFocus = subscribeAppFocus(() => {
        if (nonce === null) void ask();
      });
      return () => {
        stopFocus();
        enabled = false;
        clearExpiry();
        nonce = null;
        rebind();
      };
    },
    onlineReturned: () => {
      if (nonce === null) void ask();
    },
  };
}

/** The nonce lifecycle and both provider buttons (PM-auth "Callers"; SCR-sign-in rules 4 to 6; CTL-13). */
export function useProviders(options: ProvidersOptions): {
  appleButton: ComponentType<ScreenButtonProps> | null;
  googleButton: ComponentType<ScreenButtonProps> | null;
  busy: boolean;
} {
  const [busy, setBusy] = useState(false);
  const [controller] = useState(() => createController(options, setBusy));
  const [availability, setAvailability] = useState<ProviderAvailability | null>(null);
  const online = useIsOnline();
  const { enabled, disabled } = options;

  useEffect(() => {
    controller.setOptions(options);
  });

  useEffect(() => {
    controller.setDisabled(disabled);
  }, [controller, disabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    void controller.prepare().then((answer) => {
      if (live) setAvailability(answer);
    });
    const stop = controller.enable();
    return () => {
      live = false;
      stop();
    };
  }, [controller, enabled]);

  useEffect(() => {
    if (online && enabled) controller.onlineReturned();
  }, [controller, online, enabled]);

  return {
    appleButton: availability?.apple === true ? controller.apple.Button : null,
    googleButton: availability?.google === true ? controller.google.Button : null,
    busy,
  };
}
