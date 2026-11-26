import type { DataExportStatus } from '@citizenrun/shared';

/** What the export screen draws for the newest export and the next time one may be asked for. */
export type ExportScreenState =
  | { kind: 'none' }
  | { kind: 'queued' }
  | { kind: 'ready'; until: string }
  | { kind: 'expired' }
  | { kind: 'failed' }
  | { kind: 'wait'; until: string };

/**
 * The state of the export screen. A file being built or ready to fetch comes first; then the wait
 * before another may be asked for; then how the last one ended.
 */
export function exportState(status: DataExportStatus, now: Date): ExportScreenState {
  const { export: last, nextRequestAt } = status;
  if (last !== null && last.status === 'queued') {
    return { kind: 'queued' };
  }
  if (last !== null && last.status === 'ready') {
    return { kind: 'ready', until: last.expiresAt ?? last.readyAt ?? last.requestedAt };
  }
  if (nextRequestAt !== null && new Date(nextRequestAt).getTime() > now.getTime()) {
    return { kind: 'wait', until: nextRequestAt };
  }
  if (last !== null && (last.status === 'expired' || last.status === 'failed')) {
    return { kind: last.status };
  }
  return { kind: 'none' };
}
