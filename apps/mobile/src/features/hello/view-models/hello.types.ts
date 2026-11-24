import type { ViewState } from '@/lib/view-state';

/** SCR-hello. Ready means the API answered and its database check passed (E-WEB-02). */
export type HelloData = {
  worker: 'running' | 'stale'; // 'stale': no worker heartbeat in the last 5 minutes (D-145)
  onRefresh: () => void; // asks /readyz again
};

export type HelloViewModel = ViewState<HelloData>;
