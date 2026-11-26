import type { StateUnavailableViewModel } from './state-unavailable.types';

/** SCR-system-unavailable-in-state, built by each screen that draws it. */
export function stateUnavailableViewModel(input: {
  stateCode: string | null;
  signedIn: boolean;
  onBack: () => void;
}): StateUnavailableViewModel {
  return {
    stateCode: input.stateCode,
    signedIn: input.signedIn,
    browseHref: '/',
    deleteHref: input.signedIn ? '/settings/delete-account' : null,
    onBack: input.onBack,
  };
}
