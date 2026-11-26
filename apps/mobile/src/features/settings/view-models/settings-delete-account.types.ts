import type { ErrorCode, Me } from '@citizenrun/shared';

import type { ReauthViewModel } from '@/features/auth';
import type { Href } from '@/lib/view-models/common.types';
import type { ViewState } from '@/lib/view-state';

// SCR-settings-delete-account
export type SettingsDeleteViewModel = ViewState<{
  me: Me;
  status: 'idle' | 'confirming' | 'deleting' | 'deleted'; // SCR-settings-delete-account
  errorCode: ErrorCode | null;
  reauth: ReauthViewModel;
  exportHref: Href;
  onAskDelete: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}>;
