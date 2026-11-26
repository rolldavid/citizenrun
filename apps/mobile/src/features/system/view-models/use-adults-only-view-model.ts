import { replaceWith } from '@/lib/navigation';

import { setMinorEnded } from '../data/system-state';

import type { AdultsOnlyViewModel } from './adults-only.types';

/** SCR-system-adults-only: closing clears the minor flag, then goes to /welcome (CTL-75). */
export function useAdultsOnlyViewModel(): AdultsOnlyViewModel {
  return {
    onClose: () => {
      setMinorEnded(false);
      replaceWith('/welcome');
    },
  };
}
