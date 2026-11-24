export interface Haptics {
  /** True on phones; false on the web, where every method does nothing. */
  readonly supported: boolean;
  /** Tabs, chips, segmented controls, switches. */
  selection(): void;
  /** light: like, bookmark. medium: follow, repost. */
  impact(weight: 'light' | 'medium'): void;
  /** success: Run, a published post. warning: an error, including a rolled-back optimistic toggle. */
  notify(kind: 'success' | 'warning'): void;
}
