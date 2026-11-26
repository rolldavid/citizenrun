import { StartEmailSignInBodySchema } from '@citizenrun/shared';
import type { ErrorCode, SessionInfo } from '@citizenrun/shared';
import { useReducer, useRef, useState } from 'react';

import { failureCode, useIsOnline } from '@/lib/view-models/query';

import { requestEmailCode, retryAfterOf, verifyEmailCode } from '../data/sign-in-requests';

import { emailCodeReducer, INITIAL_EMAIL_CODE_STATE } from './email-code.machine';
import type { SignInViewModel } from './sign-in.types';

export type EmailCodeFlow = {
  stage: 'closed' | 'email' | 'code';
  email: SignInViewModel['email'];
  code: SignInViewModel['code']; // non-null while stage is 'code'
  refusal: ErrorCode | null; // reauth_mismatch, email_already_set
  open: () => void;
  close: () => void; // forgets the address and the challenge
  sendTo: (email: string) => void; // E-AUTH-01
};

const CODE_REFUSALS: ReadonlySet<string> = new Set([
  'code_invalid',
  'code_attempts_exhausted',
  'code_expired',
]);

/** The email code outside SCR-sign-in: the re-authentication sheet and "Add an email" (D-245). */
export function useEmailCodeFlow(options: {
  intent: 'reauth' | 'add_email';
  onVerified: (info: SessionInfo) => void;
}): EmailCodeFlow {
  const { intent, onVerified } = options;
  const [machine, dispatch] = useReducer(emailCodeReducer, INITIAL_EMAIL_CODE_STATE);
  const [isOpen, setOpen] = useState(false);
  const [refusal, setRefusal] = useState<ErrorCode | null>(null);
  const offline = !useIsOnline();
  const inFlight = useRef(false);
  // A new value at each close, so an answer that arrives after it is dropped.
  const generation = useRef(0);
  const { challenge } = machine;

  const close = (): void => {
    generation.current += 1;
    inFlight.current = false;
    dispatch({ type: 'changeEmail' });
    setRefusal(null);
    setOpen(false);
  };

  const sendTo = (typed: string): void => {
    if (offline || machine.email.status === 'sending' || inFlight.current) return;
    setOpen(true);
    setRefusal(null);
    const email = typed.trim().toLowerCase();
    if (!StartEmailSignInBodySchema.safeParse({ email }).success) {
      dispatch({ type: 'emailFailed', code: 'invalid_request', retryAfterSeconds: null });
      return;
    }
    const current = generation.current;
    inFlight.current = true;
    dispatch({ type: 'emailSubmitted' });
    void (async () => {
      const outcome = await requestEmailCode({ email });
      if (current !== generation.current) return;
      inFlight.current = false;
      dispatch(
        outcome.ok
          ? { type: 'emailSent', sentTo: email, result: outcome.value }
          : {
              type: 'emailFailed',
              code: failureCode(outcome.failure),
              retryAfterSeconds: retryAfterOf(outcome.failure),
            },
      );
    })();
  };

  const onSubmitCode = (code: string): void => {
    if (offline || inFlight.current || challenge === null) return;
    if (machine.code.status === 'checking') return;
    const current = generation.current;
    inFlight.current = true;
    setRefusal(null);
    dispatch({ type: 'codeSubmitted' });
    void (async () => {
      const outcome = await verifyEmailCode({ pendingToken: challenge.pendingToken, code, intent });
      if (current !== generation.current) return;
      inFlight.current = false;
      if (outcome.ok) {
        dispatch({ type: 'codeAccepted' });
        onVerified(outcome.value);
        return;
      }
      const refused = failureCode(outcome.failure);
      if (outcome.failure.kind === 'api' && CODE_REFUSALS.has(refused)) {
        dispatch({ type: 'codeRefused', code: refused });
        return;
      }
      if (intent === 'add_email' && refused === 'email_in_use') {
        dispatch({ type: 'changeEmail' });
        dispatch({ type: 'emailFailed', code: refused, retryAfterSeconds: null });
        return;
      }
      if (intent === 'reauth' && refused === 'reauth_mismatch') {
        dispatch({ type: 'changeEmail' });
        setRefusal(refused);
        return;
      }
      dispatch({ type: 'codeRefused', code: refused });
      setRefusal(refused);
    })();
  };

  const onResend = (): void => {
    if (offline || challenge === null || machine.code.resendStatus === 'sending') return;
    if (Date.now() < Date.parse(challenge.resendAvailableAt)) return;
    const current = generation.current;
    dispatch({ type: 'resendSubmitted' });
    void (async () => {
      const outcome = await requestEmailCode({
        email: challenge.sentTo,
        pendingToken: challenge.pendingToken,
      });
      if (current !== generation.current) return;
      dispatch(
        outcome.ok
          ? { type: 'resent', result: outcome.value }
          : {
              type: 'resendFailed',
              code: failureCode(outcome.failure),
              retryAfterSeconds: retryAfterOf(outcome.failure),
            },
      );
    })();
  };

  const stage = isOpen ? machine.stage : 'closed';

  return {
    stage,
    email: { ...machine.email, onSubmit: sendTo },
    code:
      stage === 'code' && challenge !== null
        ? {
            sentTo: challenge.sentTo,
            status: machine.code.status,
            resendAvailableAt: challenge.resendAvailableAt,
            resendStatus: machine.code.resendStatus,
            resendRetryAfterSeconds: machine.code.resendRetryAfterSeconds,
            onSubmit: onSubmitCode,
            onResend,
            onChangeEmail: () => {
              dispatch({ type: 'changeEmail' });
            },
          }
        : null,
    refusal,
    open: () => {
      setOpen(true);
    },
    close,
    sendTo,
  };
}
