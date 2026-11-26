import type { Href } from '@/lib/view-models/common.types';

/** SCR-system-unavailable-in-state (D-463). */
export type StateUnavailableViewModel = {
  stateCode: string | null; // a code of STATE_CODES at sign-up; null after E-ME-13
  signedIn: boolean;
  browseHref: Href; // '/'
  deleteHref: Href | null; // '/settings/delete-account' when signed in, else null
  onBack: () => void;
};
