import { links } from '@/platform/links';

import type { SystemUpdateViewModel } from './system-update.types';

/** The update screen's values: whether this build can open its store listing, and the action that does. */
export function useSystemUpdateViewModel(): SystemUpdateViewModel {
  return {
    storeSupported: links.storeListingSupported,
    onOpenStore: () => {
      void links.openStoreListing();
    },
  };
}
