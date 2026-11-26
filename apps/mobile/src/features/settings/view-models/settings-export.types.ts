import type { DataExportStatus, ErrorCode } from '@citizenrun/shared';

import type { ReauthViewModel } from '@/features/auth';
import type { ViewState } from '@/lib/view-state';

// SCR-settings-export
export type SettingsExportViewModel = ViewState<{
  status: DataExportStatus;
  requesting: boolean;
  downloading: boolean;
  errorCode: ErrorCode | 'generic' | null; // SCR-settings-export
  reauth: ReauthViewModel;
  onRequest: () => void;
  onDownload: () => void;
}>;
