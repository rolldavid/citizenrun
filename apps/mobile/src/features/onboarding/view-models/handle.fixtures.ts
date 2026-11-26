import { noop } from '@/lib/view-models/__fixtures__/common';

import type { OnboardingHandleViewModel } from './handle.types';

export const handleEmpty = {
  initialHandle: null,
  check: 'idle',
  invalidReason: null,
  submit: { status: 'idle', errorCode: null, changeAvailableAt: null },
  offline: false,
  onChange: noop,
  onContinue: noop,
  onBack: noop,
} satisfies OnboardingHandleViewModel;

export const handleChecking = {
  ...handleEmpty,
  check: 'checking',
} satisfies OnboardingHandleViewModel;

export const handleFree = {
  ...handleEmpty,
  check: 'free',
} satisfies OnboardingHandleViewModel;

export const handleTaken = {
  ...handleEmpty,
  check: 'taken',
} satisfies OnboardingHandleViewModel;

export const handleReserved = {
  ...handleEmpty,
  check: 'reserved',
} satisfies OnboardingHandleViewModel;

export const handleTooShort = {
  ...handleEmpty,
  check: 'invalid',
  invalidReason: 'too_short',
} satisfies OnboardingHandleViewModel;

export const handleTooLong = {
  ...handleEmpty,
  check: 'invalid',
  invalidReason: 'too_long',
} satisfies OnboardingHandleViewModel;

export const handleCharacters = {
  ...handleEmpty,
  check: 'invalid',
  invalidReason: 'characters',
} satisfies OnboardingHandleViewModel;

export const handleDots = {
  ...handleEmpty,
  check: 'invalid',
  invalidReason: 'dots',
} satisfies OnboardingHandleViewModel;

export const handleNoLetter = {
  ...handleEmpty,
  check: 'invalid',
  invalidReason: 'no_letter',
} satisfies OnboardingHandleViewModel;

export const handleSending = {
  ...handleEmpty,
  check: 'free',
  submit: { status: 'sending', errorCode: null, changeAvailableAt: null },
} satisfies OnboardingHandleViewModel;

export const handleRace = {
  ...handleEmpty,
  check: 'taken',
} satisfies OnboardingHandleViewModel;

export const handleChangeTooSoon = {
  ...handleEmpty,
  initialHandle: 'test_fixture',
  check: 'free',
  submit: {
    status: 'idle',
    errorCode: 'handle_change_too_soon',
    changeAvailableAt: '2027-02-14T12:00:00.000Z',
  },
} satisfies OnboardingHandleViewModel;

export const handleCheckFailed = {
  ...handleEmpty,
  check: 'failed',
} satisfies OnboardingHandleViewModel;

export const handleOffline = {
  ...handleEmpty,
  check: 'free',
  offline: true,
} satisfies OnboardingHandleViewModel;
