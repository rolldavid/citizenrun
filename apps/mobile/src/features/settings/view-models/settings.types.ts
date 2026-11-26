import type { Me } from '@citizenrun/shared';

import type { ViewState } from '@/lib/view-state';

/** SCR-settings (D-801). */
export type SettingsViewModel = ViewState<{
  me: Me;
  appVersion: string;
  legal: { terms: string; privacyPolicy: string; contentPolicy: string };
  supportEmail: string | null; // OI-support-email
  logoutStatus: 'idle' | 'sending';
  onLogout: () => void;
  onOpenLegal: (url: string) => void;
  themeChoice: 'system' | 'light' | 'dark'; // SCR-settings-appearance
  onContactSupport: (() => void) | null; // PM-links
}>;
