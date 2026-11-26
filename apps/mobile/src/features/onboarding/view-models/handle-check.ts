import { validateHandle } from '@citizenrun/shared';
import type { ErrorCode, HandleCheck, HandleError } from '@citizenrun/shared';

import { failureCode } from '@/lib/view-models/query';
import type { ApiFailure } from '@/lib/view-models/query';

import type { OnboardingHandleViewModel } from './handle.types';

export const HANDLE_CHECK_DELAY_MS = 300; // PC6B-18

export type HandleCheckState = {
  check: OnboardingHandleViewModel['check'];
  invalidReason: OnboardingHandleViewModel['invalidReason'];
};

type InvalidReason = NonNullable<OnboardingHandleViewModel['invalidReason']>;

// L-handle-rules, D-570
const REASON_OF_ERROR: Readonly<Record<Exclude<HandleError, 'reserved'>, InvalidReason>> = {
  too_short: 'too_short',
  too_long: 'too_long',
  invalid_characters: 'characters',
  edge_dot: 'dots',
  double_dot: 'dots',
  no_letter_or_digit: 'no_letter',
};

const IDLE: HandleCheckState = { check: 'idle', invalidReason: null };
const CHECKING: HandleCheckState = { check: 'checking', invalidReason: null };
const FREE: HandleCheckState = { check: 'free', invalidReason: null };
const TAKEN: HandleCheckState = { check: 'taken', invalidReason: null };
const RESERVED: HandleCheckState = { check: 'reserved', invalidReason: null };
const FAILED: HandleCheckState = { check: 'failed', invalidReason: null };

function invalid(reason: InvalidReason): HandleCheckState {
  return { check: 'invalid', invalidReason: reason };
}

/** The device's check of a typed handle; a refused value makes no request. */
export function localHandleCheck(
  value: string,
  ownHandle: string | null,
): { state: HandleCheckState; handle: string | null; askServer: boolean } {
  if (value === '') {
    return { state: IDLE, handle: null, askServer: false };
  }
  const result = validateHandle(value);
  if (!result.ok) {
    const state = result.error === 'reserved' ? RESERVED : invalid(REASON_OF_ERROR[result.error]);
    return { state, handle: null, askServer: false };
  }
  if (result.handle === ownHandle) {
    return { state: FREE, handle: result.handle, askServer: false };
  }
  return { state: CHECKING, handle: result.handle, askServer: true };
}

// E-ME-07
export function serverHandleCheck(answer: HandleCheck): HandleCheckState {
  if (answer.available) {
    return FREE;
  }
  switch (answer.reason) {
    case 'taken':
      return TAKEN;
    case 'reserved':
      return RESERVED;
    case 'invalid':
      return invalid('characters');
    case null:
      return FAILED;
  }
}

// E-ME-08
export function setHandleRefusal(
  failure: ApiFailure,
): { kind: 'check'; state: HandleCheckState } | { kind: 'error'; errorCode: ErrorCode } {
  if (failure.kind === 'api') {
    if (failure.code === 'handle_taken') {
      return { kind: 'check', state: TAKEN };
    }
    if (failure.code === 'handle_reserved') {
      return { kind: 'check', state: RESERVED };
    }
    if (failure.code === 'invalid_request') {
      const field = failure.fields['handle'];
      if (field === 'too_short' || field === 'too_long') {
        return { kind: 'check', state: invalid(field) };
      }
      if (field === 'invalid_format') {
        return { kind: 'check', state: invalid('characters') };
      }
    }
  }
  return { kind: 'error', errorCode: failureCode(failure) };
}
