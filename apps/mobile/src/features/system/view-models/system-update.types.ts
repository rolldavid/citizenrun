/** SCR-system-update: the blocking update screen after a 426. */
export type SystemUpdateViewModel = {
  storeSupported: boolean; // false on the web and on a phone build with no store URL
  onOpenStore: () => void;
};
