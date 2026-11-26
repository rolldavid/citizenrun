import { assertNever } from '@citizenrun/shared';

import type { ApiFailure } from '@/lib/view-models/query';
import type { CropRect, PickOutcome, PrepareOutcome } from '@/platform/upload/types';

import type { PhotoFailure } from './photo.types';

/** The centred square of the picked item, in its pixels after orientation (D-547, D-569). */
export function centredSquare(item: { width: number; height: number }): CropRect {
  const side = Math.min(item.width, item.height);
  return {
    originX: Math.floor((item.width - side) / 2),
    originY: Math.floor((item.height - side) / 2),
    width: side,
    height: side,
  };
}

/** What a pick that chose nothing shows; null changes nothing. */
export function failureOfPick(
  outcome: Exclude<PickOutcome, { kind: 'picked' }>,
): PhotoFailure | null {
  switch (outcome.kind) {
    case 'cancelled':
      return null;
    case 'denied':
      return outcome.state === 'blocked' ? 'photos_blocked' : null;
    case 'failed':
      return 'prepare_failed';
    default:
      return assertNever(outcome);
  }
}

/** What a prepare that made no file shows; null changes nothing. */
export function failureOfPrepare(
  outcome: Exclude<PrepareOutcome, { kind: 'ready' }>,
): PhotoFailure | null {
  switch (outcome.kind) {
    case 'rejected':
      return outcome.reason;
    case 'cancelled':
      return null;
    case 'failed':
      return 'prepare_failed';
    default:
      return assertNever(outcome);
  }
}

// E-UPL-01
export function failureOfTicket(failure: ApiFailure): PhotoFailure {
  if (failure.kind !== 'api') {
    return 'generic';
  }
  if (failure.code === 'rate_limited' || failure.code === 'daily_limit_reached') {
    return 'rate_limited';
  }
  return failure.code === 'upload_too_large' ? 'photo_too_large' : 'generic';
}

// E-ME-02
export function failureOfAttach(failure: ApiFailure): PhotoFailure {
  if (failure.kind !== 'api') {
    return 'generic';
  }
  if (failure.code === 'rate_limited') {
    return 'rate_limited';
  }
  return failure.code === 'upload_invalid' ? 'upload_failed' : 'generic';
}
