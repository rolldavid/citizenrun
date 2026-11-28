import type { ErrorCode, SignupDetails } from '@citizenrun/shared';

import type { AgeOutcome } from '@/platform/age-assurance';

import { emailCodeReducer, INITIAL_EMAIL_CODE_STATE } from './email-code.machine';
import type { EmailCodeEvent, EmailCodeState } from './email-code.machine';
import type { SignInStage, SignInViewModel } from './sign-in.types';

export type PendingCredential =
  | { kind: 'email'; pendingToken: string; code: string }
  | {
      kind: 'apple';
      idToken: string;
      code: string | null;
      nonce: string;
      name: { givenName: string | null; familyName: string | null } | null;
    }
  | { kind: 'apple_handoff'; code: string; nonce: string }
  | { kind: 'google'; idToken: string; nonce: string };

export type SignInMachineState = {
  stage: SignInStage;
  emailCode: EmailCodeState;
  pending: PendingCredential | null; // memory only
  age: SignupDetails['age'] | null;
  state: string | null;
  notice: SignInViewModel['notice'];
  providersBusy: boolean;
  blocked: SignInViewModel['blocked'];
};

export type SignInEvent =
  | { type: 'chooseEmail' }
  | { type: 'emailCode'; event: EmailCodeEvent }
  | { type: 'signupRequired'; pending: PendingCredential }
  | { type: 'storeSignal'; outcome: AgeOutcome }
  | { type: 'storeSignalUnsupported' }
  | { type: 'agreed' }
  | { type: 'stateRequired' }
  | { type: 'statePicked'; code: string }
  | { type: 'finishRefused'; code: ErrorCode | 'generic'; retryAfterSeconds: number | null }
  | { type: 'signedIn' }
  | { type: 'providerStarted' }
  | { type: 'providerEnded' }
  | {
      type: 'providerNotice';
      code: ErrorCode | 'provider_unavailable' | 'generic';
      retryAfterSeconds: number | null;
    }
  | { type: 'back' }
  | { type: 'clearBlock' }; // SCR-system-unavailable-in-state

export const INITIAL_SIGN_IN_STATE: SignInMachineState = {
  stage: 'methods',
  emailCode: INITIAL_EMAIL_CODE_STATE,
  pending: null,
  age: null,
  state: null,
  notice: null,
  providersBusy: false,
  blocked: null,
};

const SIGNING_UP: ReadonlySet<SignInStage> = new Set([
  'checkingAge',
  'state',
  'agreements',
  'finishing',
]);

export function isSigningUp(state: SignInMachineState): boolean {
  return SIGNING_UP.has(state.stage);
}

function dropAnswers(state: SignInMachineState): SignInMachineState {
  return { ...state, pending: null, age: null, state: null };
}

function block(state: SignInMachineState, blocked: SignInViewModel['blocked']): SignInMachineState {
  return { ...dropAnswers(state), blocked, stage: 'methods' };
}

function finishRefused(
  state: SignInMachineState,
  event: Extract<SignInEvent, { type: 'finishRefused' }>,
): SignInMachineState {
  if (state.stage === 'finishing') {
    if (event.code === 'code_expired' && state.pending?.kind === 'email') {
      return {
        ...dropAnswers(state),
        stage: 'code',
        emailCode: { ...state.emailCode, code: { ...state.emailCode.code, status: 'expired' } },
      };
    }
    if (event.code === 'unavailable_in_state' && state.state !== null) {
      return block(state, { stateUnavailable: state.state });
    }
    if (event.code === 'age_signal_required') {
      return {
        ...dropAnswers(state),
        stage: 'methods',
        notice: { code: 'age_signal_required', retryAfterSeconds: null },
      };
    }
  }
  if (state.stage !== 'finishing' && state.stage !== 'code') return state;
  return {
    ...dropAnswers(state),
    stage: 'methods',
    notice: { code: event.code, retryAfterSeconds: event.retryAfterSeconds },
    emailCode: INITIAL_EMAIL_CODE_STATE,
  };
}

// Sign-up asks no age (D-897): with no store signal it goes on and says that none came.
const NO_SIGNAL: SignupDetails['age'] = { method: 'none', sourceTier: null };

function storeSignal(state: SignInMachineState, outcome: AgeOutcome): SignInMachineState {
  switch (outcome.kind) {
    case 'adult':
      return {
        ...state,
        stage: 'agreements',
        age: { method: 'store_signal', sourceTier: outcome.tier },
      };
    case 'minor':
      return block(state, 'adultsOnly');
    case 'unavailable':
      return { ...state, stage: 'agreements', age: NO_SIGNAL };
  }
}

function back(state: SignInMachineState): SignInMachineState {
  if (state.blocked !== null) return state;
  switch (state.stage) {
    case 'email':
      return { ...state, stage: 'methods' };
    case 'code':
      return { ...state, stage: 'email', emailCode: INITIAL_EMAIL_CODE_STATE };
    case 'agreements':
      return { ...dropAnswers(state), stage: 'methods' };
    case 'state':
      return { ...state, stage: 'agreements' };
    case 'methods':
    case 'checkingAge':
    case 'finishing':
      return state;
  }
}

/** SCR-sign-in's stages: a pure reducer. An event its stage does not take leaves the state unchanged. */
export function signInReducer(state: SignInMachineState, event: SignInEvent): SignInMachineState {
  switch (event.type) {
    case 'chooseEmail':
      if (state.stage !== 'methods') return state;
      return { ...state, stage: 'email', notice: null, emailCode: INITIAL_EMAIL_CODE_STATE };
    case 'emailCode': {
      if (state.stage !== 'email' && state.stage !== 'code') return state;
      const emailCode = emailCodeReducer(state.emailCode, event.event);
      return { ...state, emailCode, stage: emailCode.stage };
    }
    case 'signupRequired':
      if (state.stage !== 'code' && state.stage !== 'methods') return state;
      return {
        ...state,
        stage: 'checkingAge',
        pending: event.pending,
        age: null,
        state: null,
        notice: null,
        providersBusy: false,
      };
    case 'storeSignal':
      if (state.stage !== 'checkingAge') return state;
      return storeSignal(state, event.outcome);
    case 'storeSignalUnsupported':
      if (state.stage !== 'checkingAge') return state;
      return { ...state, stage: 'agreements', age: NO_SIGNAL };
    // The one box of sign-up was ticked and Continue pressed (D-900): the account is made.
    case 'agreed':
      if (state.stage !== 'agreements') return state;
      return { ...state, stage: 'finishing' };
    case 'stateRequired':
      if (state.stage !== 'finishing') return state;
      return { ...state, stage: 'state' };
    case 'statePicked':
      if (state.stage !== 'state') return state;
      return { ...state, stage: 'finishing', state: event.code };
    case 'finishRefused':
      return finishRefused(state, event);
    case 'signedIn':
      return { ...state, pending: null, providersBusy: false };
    case 'providerStarted':
      if (state.stage !== 'methods') return state;
      return { ...state, providersBusy: true, notice: null };
    case 'providerEnded':
      return { ...state, providersBusy: false };
    case 'providerNotice':
      return {
        ...state,
        stage: 'methods',
        notice: { code: event.code, retryAfterSeconds: event.retryAfterSeconds },
        providersBusy: false,
      };
    case 'back':
      return back(state);
    case 'clearBlock':
      return state.blocked === null ? state : { ...state, blocked: null };
  }
}
