import type { OfficeSummary, PersonSummary } from '@citizenrun/shared';

/** An internal path that passes safeInternalPath. */
export type Href = string;

/** Why Run cannot be taken. Decided by the view-model, never by a component (C-ActionRow). */
export type RunUnavailableReason = 'placeholder' | 'retired' | 'noElection' | 'closed';

export type OfficeActions = {
  runState: 'idle' | 'running' | 'unavailable' | 'hidden';
  runUnavailable: RunUnavailableReason | null; // set only when runState is 'unavailable'
  following: boolean;
  bookmarked: boolean;
  onRun: () => void; // idle: POST E-RUN-01, then opens the run plan; running: opens the run plan
  onToggleFollow: () => void; // E-OFF-04 / E-OFF-05, optimistic
  onToggleBookmark: () => void; // E-OFF-06 / E-OFF-07, optimistic
};

export type OfficeEntry = {
  office: OfficeSummary;
  href: Href; // '/office/<slug>'
  actions: OfficeActions;
  itemKey: string; // 'office:<id>', for once-per-item motion and feed events
};

export type PersonEntry = {
  person: PersonSummary;
  href: Href | null; // '/c/<slug>'; null when person.rosterOnly
  onToggleFollow: (() => void) | null; // null while person follows are not offered and when logged out
};
