import type { ErrorCode, Me } from '@citizenrun/shared';

import type { ViewState } from '@/lib/view-state';

// SCR-settings-privacy
export type SettingsPrivacyViewModel = ViewState<{
  me: Me;
  saving: 'aiScreening' | null;
  errorCode: ErrorCode | null; // SCR-settings-privacy
  onSetAiScreening: (granted: boolean) => void;
}>;
