import { noop } from '@/lib/view-models/__fixtures__/common';

import type { OnboardingLocationSoonViewModel } from './location.types';

export const locationSoon = {
  skipStatus: 'idle',
  errorCode: null,
  offline: false,
  onSkip: noop,
  onBack: noop,
} satisfies OnboardingLocationSoonViewModel;

export const locationSoonSending = {
  ...locationSoon,
  skipStatus: 'sending',
} satisfies OnboardingLocationSoonViewModel;

export const locationSoonError = {
  ...locationSoon,
  errorCode: 'unavailable',
} satisfies OnboardingLocationSoonViewModel;

export const locationSoonOffline = {
  ...locationSoon,
  offline: true,
} satisfies OnboardingLocationSoonViewModel;
