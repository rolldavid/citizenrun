import type { OfficeSummary } from '@citizenrun/shared';

import type { OfficeActions, RunUnavailableReason } from './common.types';

export type RunStateInput = Pick<OfficeSummary, 'placeholder' | 'retiredAt' | 'filingStatus'> & {
  viewer: Pick<OfficeSummary['viewer'], 'running'>;
};

/** Run's slot for an office; 'hidden' whenever Run is not built yet. */
export function runStateFor(
  office: RunStateInput,
  milestoneHasRun: boolean,
): { runState: OfficeActions['runState']; runUnavailable: RunUnavailableReason | null } {
  if (!milestoneHasRun) {
    return { runState: 'hidden', runUnavailable: null };
  }
  // E-RUN-01 answers 422 office_not_runnable for a placeholder and office_retired for a retired one.
  if (office.placeholder) {
    return { runState: 'unavailable', runUnavailable: 'placeholder' };
  }
  if (office.retiredAt !== null) {
    return { runState: 'unavailable', runUnavailable: 'retired' };
  }
  // A runner keeps the way to the plan, whatever the filing status.
  if (office.viewer.running) {
    return { runState: 'running', runUnavailable: null };
  }
  switch (office.filingStatus) {
    case 'no_election':
      return { runState: 'unavailable', runUnavailable: 'noElection' };
    case 'closed':
      return { runState: 'unavailable', runUnavailable: 'closed' };
    // Filing not open yet, or dates not known: the API accepts a run (PC6B-03, D-514).
    case 'not_open_yet':
    case 'opens_not_known':
    case 'dates_not_known':
    case 'open':
      return { runState: 'idle', runUnavailable: null };
    default:
      // A status the API adds later leaves Run as it is for an open window.
      return { runState: 'idle', runUnavailable: null };
  }
}
