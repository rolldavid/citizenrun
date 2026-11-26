import type { EmailStartResult, ErrorCode } from '@citizenrun/shared';

/** The email and code stages of SCR-sign-in, the re-authentication sheet and "Add an email". */
export type EmailCodeState = {
  stage: 'email' | 'code';
  email: {
    status: 'idle' | 'sending';
    errorCode: ErrorCode | null;
    retryAfterSeconds: number | null;
  };
  challenge: { sentTo: string; pendingToken: string; resendAvailableAt: string } | null;
  code: {
    status: 'idle' | 'checking' | 'wrong' | 'locked' | 'expired';
    resendStatus: 'idle' | 'sending' | 'limited';
    resendRetryAfterSeconds: number | null;
  };
};

export type EmailCodeEvent =
  | { type: 'emailSubmitted' }
  | { type: 'emailSent'; sentTo: string; result: EmailStartResult }
  | { type: 'emailFailed'; code: ErrorCode; retryAfterSeconds: number | null }
  | { type: 'codeSubmitted' }
  | { type: 'codeRefused'; code: ErrorCode }
  | { type: 'codeAccepted' }
  | { type: 'resendSubmitted' }
  | { type: 'resent'; result: EmailStartResult }
  | { type: 'resendFailed'; code: ErrorCode; retryAfterSeconds: number | null }
  | { type: 'changeEmail' };

const IDLE_CODE: EmailCodeState['code'] = {
  status: 'idle',
  resendStatus: 'idle',
  resendRetryAfterSeconds: null,
};

export const INITIAL_EMAIL_CODE_STATE: EmailCodeState = {
  stage: 'email',
  email: { status: 'idle', errorCode: null, retryAfterSeconds: null },
  challenge: null,
  code: IDLE_CODE,
};

const REFUSED_STATUS: Partial<Record<ErrorCode, EmailCodeState['code']['status']>> = {
  code_invalid: 'wrong',
  code_attempts_exhausted: 'locked',
  code_expired: 'expired',
};

function refusedStatus(code: ErrorCode): EmailCodeState['code']['status'] {
  return REFUSED_STATUS[code] ?? 'idle';
}

export function emailCodeReducer(state: EmailCodeState, event: EmailCodeEvent): EmailCodeState {
  switch (event.type) {
    case 'emailSubmitted':
      return { ...state, email: { status: 'sending', errorCode: null, retryAfterSeconds: null } };
    case 'emailSent':
      return {
        stage: 'code',
        email: { ...state.email, status: 'idle' },
        challenge: {
          sentTo: event.sentTo,
          pendingToken: event.result.pendingToken,
          resendAvailableAt: event.result.resendAvailableAt,
        },
        code: IDLE_CODE,
      };
    case 'emailFailed':
      return {
        ...state,
        email: {
          status: 'idle',
          errorCode: event.code,
          retryAfterSeconds: event.retryAfterSeconds,
        },
      };
    case 'codeSubmitted':
      return { ...state, code: { ...state.code, status: 'checking' } };
    case 'codeRefused':
      return { ...state, code: { ...state.code, status: refusedStatus(event.code) } };
    case 'codeAccepted':
      return { ...state, code: { ...state.code, status: 'idle' } };
    case 'resendSubmitted':
      return { ...state, code: { ...state.code, resendStatus: 'sending' } };
    case 'resent':
      if (state.challenge === null) return state;
      return {
        ...state,
        challenge: {
          ...state.challenge,
          pendingToken: event.result.pendingToken,
          resendAvailableAt: event.result.resendAvailableAt,
        },
        code: IDLE_CODE,
      };
    case 'resendFailed':
      if (event.code === 'rate_limited') {
        return {
          ...state,
          code: {
            ...state.code,
            resendStatus: 'limited',
            resendRetryAfterSeconds: event.retryAfterSeconds,
          },
        };
      }
      return {
        stage: 'email',
        email: {
          status: 'idle',
          errorCode: event.code,
          retryAfterSeconds: event.retryAfterSeconds,
        },
        challenge: null,
        code: IDLE_CODE,
      };
    case 'changeEmail':
      return INITIAL_EMAIL_CODE_STATE;
  }
}
