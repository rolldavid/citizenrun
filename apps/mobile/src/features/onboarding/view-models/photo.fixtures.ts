import { FIXTURE_PHOTO_URI, noop } from '@/lib/view-models/__fixtures__/common';

import type { OnboardingPhotoViewModel } from './photo.types';

const CALLBACKS = { onChoose: noop, onContinue: noop, onSkip: noop, onOpenSettings: noop };

export const photoNone = {
  photo: { status: 'none' },
  skipStatus: 'idle',
  offline: false,
  ...CALLBACKS,
} satisfies OnboardingPhotoViewModel;

export const photoReady = {
  ...photoNone,
  photo: { status: 'ready', previewUri: FIXTURE_PHOTO_URI },
} satisfies OnboardingPhotoViewModel;

export const photoUploading = {
  ...photoNone,
  photo: {
    status: 'uploading',
    previewUri: FIXTURE_PHOTO_URI,
    sentBytes: 120_000,
    totalBytes: 480_000,
  },
} satisfies OnboardingPhotoViewModel;

export const photoFailedPhotosBlocked = {
  ...photoNone,
  photo: { status: 'failed', previewUri: null, failure: 'photos_blocked' },
} satisfies OnboardingPhotoViewModel;

export const photoFailedUnsupportedFormat = {
  ...photoNone,
  photo: { status: 'failed', previewUri: null, failure: 'unsupported_format' },
} satisfies OnboardingPhotoViewModel;

export const photoFailedPhotoTooLarge = {
  ...photoNone,
  photo: { status: 'failed', previewUri: null, failure: 'photo_too_large' },
} satisfies OnboardingPhotoViewModel;

export const photoFailedPrepareFailed = {
  ...photoNone,
  photo: { status: 'failed', previewUri: null, failure: 'prepare_failed' },
} satisfies OnboardingPhotoViewModel;

export const photoFailedUploadFailed = {
  ...photoNone,
  photo: { status: 'failed', previewUri: FIXTURE_PHOTO_URI, failure: 'upload_failed' },
} satisfies OnboardingPhotoViewModel;

export const photoFailedRateLimited = {
  ...photoNone,
  photo: { status: 'failed', previewUri: FIXTURE_PHOTO_URI, failure: 'rate_limited' },
} satisfies OnboardingPhotoViewModel;

export const photoFailedGeneric = {
  ...photoNone,
  photo: { status: 'failed', previewUri: FIXTURE_PHOTO_URI, failure: 'generic' },
} satisfies OnboardingPhotoViewModel;

export const photoSkipping = {
  ...photoNone,
  skipStatus: 'sending',
} satisfies OnboardingPhotoViewModel;

export const photoOffline = {
  ...photoReady,
  offline: true,
} satisfies OnboardingPhotoViewModel;
