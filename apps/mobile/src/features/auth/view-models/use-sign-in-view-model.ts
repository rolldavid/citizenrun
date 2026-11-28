import { STATE_CODES, StartEmailSignInBodySchema } from '@citizenrun/shared';
import type { SessionInfo, SignupDetails } from '@citizenrun/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useReducer, useRef } from 'react';

import { publicPageUrl, rememberNext, replaceWith, welcomeHref } from '@/lib/navigation';
import { failureCode, useIsOnline } from '@/lib/view-models/query';
import type { ApiFailure, Outcome } from '@/lib/view-models/query';
import { ageAssurance } from '@/platform/age-assurance';
import type { AgeOutcome } from '@/platform/age-assurance';

import { startSession } from '../data/session-start';
import {
  postAppleHandoff,
  postAppleToken,
  postGoogleToken,
  requestEmailCode,
  retryAfterOf,
  verifyEmailCode,
} from '../data/sign-in-requests';

import type { EmailCodeEvent } from './email-code.machine';
import { INITIAL_SIGN_IN_STATE, isSigningUp, signInReducer } from './sign-in.machine';
import type { PendingCredential, SignInEvent } from './sign-in.machine';
import type { SignInViewModel } from './sign-in.types';
import { buildSignupDetails } from './signup-details';
import { useProviders } from './use-providers';

const CODE_REFUSALS: ReadonlySet<string> = new Set([
  'code_invalid',
  'code_attempts_exhausted',
  'code_expired',
]);

function emailEvent(event: EmailCodeEvent): SignInEvent {
  return { type: 'emailCode', event };
}

function isSignupRequired(failure: ApiFailure): boolean {
  return failure.kind === 'api' && failure.code === 'signup_details_required';
}

// SCR-sign-in rule 3 (D-530)
function isStateRequired(failure: ApiFailure): boolean {
  return (
    failure.kind === 'api' &&
    failure.code === 'invalid_request' &&
    failure.fields['signup.state'] === 'required'
  );
}

// SCR-sign-in rule 1: the first credential, repeated with the sign-up answers.
function repeatWithSignup(
  pending: PendingCredential,
  signup: SignupDetails,
): Promise<Outcome<SessionInfo>> {
  switch (pending.kind) {
    case 'email':
      return verifyEmailCode({
        pendingToken: pending.pendingToken,
        code: pending.code,
        intent: 'sign_in',
        signup,
      });
    case 'apple':
      return postAppleToken({
        idToken: pending.idToken,
        code: pending.code,
        nonce: pending.nonce,
        intent: 'sign_in',
        signup,
        ...(pending.name !== null ? { name: pending.name } : {}),
      });
    case 'apple_handoff':
      return postAppleHandoff({
        code: pending.code,
        nonce: pending.nonce,
        intent: 'sign_in',
        signup,
      });
    case 'google':
      return postGoogleToken({
        idToken: pending.idToken,
        nonce: pending.nonce,
        intent: 'sign_in',
        signup,
      });
  }
}

// PM-age-assurance "Callers": the sign-up account step. It asks the person nothing (D-897).
async function checkAge(): Promise<SignInEvent> {
  if (!ageAssurance.storeSignalSupported) return { type: 'storeSignalUnsupported' };
  let outcome: AgeOutcome;
  try {
    outcome = await ageAssurance.requestStoreSignal();
  } catch {
    outcome = { kind: 'unavailable' };
  }
  return { type: 'storeSignal', outcome };
}

/** SCR-sign-in. The route file passes the `next` parameter. */
export function useSignInViewModel(input: { next: string | null }): SignInViewModel {
  const [state, dispatch] = useReducer(signInReducer, INITIAL_SIGN_IN_STATE);
  const offline = !useIsOnline();
  const client = useQueryClient();
  const inFlight = useRef(false);
  const resending = useRef(false);
  const { emailCode } = state;
  const challenge = emailCode.challenge;

  const finishSignIn = async (info: SessionInfo): Promise<void> => {
    const started = await startSession(info, client);
    if (started === 'store_failed') {
      dispatch({ type: 'providerNotice', code: 'generic', retryAfterSeconds: null });
      return;
    }
    if (info.created) rememberNext(input.next);
    dispatch({ type: 'signedIn' });
  };

  const startSignup = (pending: PendingCredential): void => {
    dispatch({ type: 'signupRequired', pending });
    void checkAge().then(dispatch);
  };

  const providers = useProviders({
    intent: 'sign_in',
    enabled: true,
    disabled: emailCode.email.status === 'sending' || offline,
    onStart: () => {
      dispatch({ type: 'providerStarted' });
    },
    onEnded: () => {
      dispatch({ type: 'providerEnded' });
    },
    onAttempt: (attempt) => {
      switch (attempt.kind) {
        case 'session':
          void finishSignIn(attempt.info);
          return;
        case 'signupRequired':
          startSignup(attempt.pending);
          return;
        case 'refused':
          dispatch({
            type: 'providerNotice',
            code: attempt.code,
            retryAfterSeconds: attempt.retryAfterSeconds,
          });
          return;
      }
    },
  });

  const onSubmitEmail = (typed: string): void => {
    if (offline || emailCode.email.status === 'sending' || inFlight.current) return;
    const email = typed.trim().toLowerCase();
    if (!StartEmailSignInBodySchema.safeParse({ email }).success) {
      dispatch(
        emailEvent({ type: 'emailFailed', code: 'invalid_request', retryAfterSeconds: null }),
      );
      return;
    }
    inFlight.current = true;
    dispatch(emailEvent({ type: 'emailSubmitted' }));
    void (async () => {
      const outcome = await requestEmailCode({ email });
      inFlight.current = false;
      dispatch(
        emailEvent(
          outcome.ok
            ? { type: 'emailSent', sentTo: email, result: outcome.value }
            : {
                type: 'emailFailed',
                code: failureCode(outcome.failure),
                retryAfterSeconds: retryAfterOf(outcome.failure),
              },
        ),
      );
    })();
  };

  const onSubmitCode = (code: string): void => {
    if (offline || inFlight.current || challenge === null) return;
    if (emailCode.code.status === 'checking') return;
    const { pendingToken } = challenge;
    inFlight.current = true;
    dispatch(emailEvent({ type: 'codeSubmitted' }));
    void (async () => {
      const outcome = await verifyEmailCode({ pendingToken, code, intent: 'sign_in' });
      inFlight.current = false;
      if (outcome.ok) {
        dispatch(emailEvent({ type: 'codeAccepted' }));
        await finishSignIn(outcome.value);
        return;
      }
      const { failure } = outcome;
      if (isSignupRequired(failure)) {
        startSignup({ kind: 'email', pendingToken, code });
        return;
      }
      if (failure.kind === 'api' && CODE_REFUSALS.has(failure.code)) {
        dispatch(emailEvent({ type: 'codeRefused', code: failure.code }));
        return;
      }
      dispatch({
        type: 'finishRefused',
        code: failureCode(failure),
        retryAfterSeconds: retryAfterOf(failure),
      });
    })();
  };

  const onResend = (): void => {
    // The ref, not the rendered status: two presses before a render send one request
    if (offline || challenge === null || resending.current) return;
    if (emailCode.code.resendStatus === 'sending') return;
    if (Date.now() < Date.parse(challenge.resendAvailableAt)) return;
    resending.current = true;
    dispatch(emailEvent({ type: 'resendSubmitted' }));
    void (async () => {
      const outcome = await requestEmailCode({
        email: challenge.sentTo,
        pendingToken: challenge.pendingToken,
      });
      resending.current = false;
      dispatch(
        emailEvent(
          outcome.ok
            ? { type: 'resent', result: outcome.value }
            : {
                type: 'resendFailed',
                code: failureCode(outcome.failure),
                retryAfterSeconds: retryAfterOf(outcome.failure),
              },
        ),
      );
    })();
  };

  const finish = (answers: { state: string | null }): void => {
    const { pending, age } = state;
    if (pending === null || age === null || inFlight.current) return;
    const signup = buildSignupDetails({ age, ...answers });
    inFlight.current = true;
    void (async () => {
      const outcome = await repeatWithSignup(pending, signup);
      inFlight.current = false;
      if (outcome.ok) {
        await finishSignIn(outcome.value);
        return;
      }
      if (isStateRequired(outcome.failure)) {
        dispatch({ type: 'stateRequired' });
        return;
      }
      dispatch({
        type: 'finishRefused',
        code: failureCode(outcome.failure),
        retryAfterSeconds: retryAfterOf(outcome.failure),
      });
    })();
  };

  // D-900: the screen calls this only once the box is ticked.
  const onAgree = (): void => {
    if (offline || inFlight.current) return;
    dispatch({ type: 'agreed' });
    finish({ state: null });
  };

  const onSubmitState = (code: string): void => {
    if (offline || inFlight.current) return;
    dispatch({ type: 'statePicked', code });
    finish({ state: code });
  };

  const onBack = (): void => {
    const { blocked } = state;
    if (blocked === 'adultsOnly') {
      replaceWith('/welcome');
      return;
    }
    if (blocked !== null) {
      dispatch({ type: 'clearBlock' });
      dispatch({ type: 'back' });
      return;
    }
    if (state.stage === 'methods') {
      replaceWith(welcomeHref(input.next));
      return;
    }
    dispatch({ type: 'back' });
  };

  return {
    stage: state.stage,
    signingUp: isSigningUp(state),
    providersBusy: state.providersBusy,
    appleButton: providers.appleButton,
    googleButton: providers.googleButton,
    notice: state.notice,
    legalLinks: { terms: publicPageUrl('/terms'), privacyPolicy: publicPageUrl('/privacy') },
    email: { ...emailCode.email, onSubmit: onSubmitEmail },
    code:
      state.stage === 'code' && challenge !== null
        ? {
            sentTo: challenge.sentTo,
            status: emailCode.code.status,
            resendAvailableAt: challenge.resendAvailableAt,
            resendStatus: emailCode.code.resendStatus,
            resendRetryAfterSeconds: emailCode.code.resendRetryAfterSeconds,
            onSubmit: onSubmitCode,
            onResend,
            onChangeEmail: () => {
              dispatch(emailEvent({ type: 'changeEmail' }));
            },
          }
        : null,
    statePicker: state.stage === 'state' ? { codes: STATE_CODES, onSubmit: onSubmitState } : null,
    agreements:
      state.stage === 'agreements'
        ? {
            links: { terms: publicPageUrl('/terms'), privacyPolicy: publicPageUrl('/privacy') },
            onAgree,
          }
        : null,
    blocked: state.blocked,
    offline,
    onChooseEmail: () => {
      dispatch({ type: 'chooseEmail' });
    },
    onBack,
  };
}
