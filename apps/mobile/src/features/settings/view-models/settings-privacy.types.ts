import type { Me } from '@citizenrun/shared';

import type { ViewState } from '@/lib/view-state';

// SCR-settings-privacy
export type SettingsPrivacyViewModel = ViewState<{ me: Me }>;
