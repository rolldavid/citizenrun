/** SCR-system-error: a render error the reload-once boundary could not clear. */
export type SystemErrorViewModel = {
  onRetry: () => void; // the boundary's reset
};
