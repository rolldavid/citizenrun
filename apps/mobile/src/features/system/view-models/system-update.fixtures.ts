import type { SystemUpdateViewModel } from './system-update.types';

export const updateWithStore: SystemUpdateViewModel = {
  storeSupported: true,
  onOpenStore: () => undefined,
};

export const updateNoStore: SystemUpdateViewModel = {
  storeSupported: false,
  onOpenStore: () => undefined,
};
