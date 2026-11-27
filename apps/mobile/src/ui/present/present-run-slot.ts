import { assertNever } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';

import type { OfficeActions, RunUnavailableReason } from '@/lib/view-models/common.types';
import type { RunSlot } from '@/ui/components/action-row';

function unavailableLabel(reason: RunUnavailableReason, t: TFunction): string {
  switch (reason) {
    case 'placeholder':
      return t('office:run.unavailable.placeholder');
    case 'retired':
      return t('office:run.unavailable.retired');
    case 'noElection':
      return t('office:run.unavailable.noElection');
    case 'closed':
      return t('office:run.unavailable.closed');
    default:
      return assertNever(reason);
  }
}

/**
 * The Run slot of C-ActionRow from what the view-model decided. An unavailable Run says why; one
 * with no reason is a programming error and throws.
 */
export function presentRunSlot(
  actions: Pick<OfficeActions, 'runState' | 'runUnavailable'>,
  t: TFunction,
): RunSlot {
  switch (actions.runState) {
    case 'hidden':
      return { state: 'hidden' };
    case 'idle':
      return { state: 'idle' };
    case 'running':
      return { state: 'running' };
    case 'unavailable':
      if (actions.runUnavailable === null) {
        throw new Error('An unavailable Run needs its reason.');
      }
      return { state: 'unavailable', label: unavailableLabel(actions.runUnavailable, t) };
    default:
      return assertNever(actions.runState);
  }
}
