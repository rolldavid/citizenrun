import { assertNever } from '@citizenrun/shared';

import type { PhotoFailure } from '@/features/onboarding/view-models/photo.types';

import type { StepT } from './step-translation';

/** What the photo step says when choosing, preparing or sending a photo did not work. */
export function photoFailureText(failure: PhotoFailure, t: StepT): string {
  switch (failure) {
    case 'photos_blocked':
      return t('common:device.photos.blocked');
    case 'unsupported_format':
      return t('common:device.upload.unsupportedFormat');
    case 'photo_too_large':
      return t('common:device.upload.photoTooLarge');
    case 'prepare_failed':
      return t('common:device.upload.prepareFailed');
    case 'upload_failed':
      return t('common:device.upload.failed');
    case 'rate_limited':
      return t('errors:rate_limited');
    case 'generic':
      return t('errors:generic');
    default:
      return assertNever(failure);
  }
}
