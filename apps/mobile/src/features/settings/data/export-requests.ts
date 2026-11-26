import type { DataExportStatus, DataExportView, ExportDownload } from '@citizenrun/shared';
import {
  getExportDownload,
  requestExport as postExport,
  useGetExport,
} from '@citizenrun/shared/api';

import { attempt, querySource } from '@/lib/view-models/query';
import type { Outcome, QuerySource } from '@/lib/view-models/query';

export const EXPORT_POLL_MS = 10_000; // SCR-settings-export

/** EXPORT_POLL_MS while the newest export is queued, else false. */
export function exportPollInterval(status: DataExportStatus | undefined): number | false {
  return status?.export?.status === 'queued' ? EXPORT_POLL_MS : false;
}

// E-ME-05
export function useExportStatus(): {
  status: DataExportStatus | null;
  source: QuerySource;
  refetch: () => void;
} {
  const query = useGetExport({
    query: { refetchInterval: (current) => exportPollInterval(current.state.data) },
  });
  const status: DataExportStatus | null = query.data ?? null;
  const refetch = query.refetch;
  return {
    status,
    source: querySource(query),
    refetch: () => {
      void refetch();
    },
  };
}

// E-ME-04
export function requestExport(): Promise<Outcome<DataExportView>> {
  return attempt(() => postExport({}));
}

// E-ME-06; the link is a secret: never cached, logged or kept
export function exportDownload(): Promise<Outcome<ExportDownload>> {
  return attempt(() => getExportDownload());
}
