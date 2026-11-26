import { BRAND } from '@citizenrun/shared';
import type { BrandContacts } from '@citizenrun/shared';

import { useLogout } from '@/features/auth';
import { useMe, useThemeChoice } from '@/features/system';
import { publicPageUrl } from '@/lib/navigation';
import { useIsOnline, viewStateOf } from '@/lib/view-models/query';
import { links } from '@/platform/links';
import { session } from '@/platform/session';

import type { SettingsViewModel } from './settings.types';

type SettingsData = Extract<SettingsViewModel, { status: 'ready' }>['data'];

// OI-support-email: null until the owner gives the address
function supportEmailOf(): string | null {
  const contacts: BrandContacts = BRAND.contacts;
  return contacts.supportEmail;
}

function openLegal(url: string): void {
  void links.openExternal(url);
}

/** SCR-settings: E-ME-01; E-AUTH-09 through useLogout (PC6C-15). */
export function useSettingsViewModel(): SettingsViewModel {
  const { me, source } = useMe();
  const online = useIsOnline();
  const logout = useLogout();
  const themeChoice = useThemeChoice();

  const view = viewStateOf<SettingsData | null>(
    [source],
    () => {
      if (me === null) return null;
      const supportEmail = supportEmailOf();
      return {
        me,
        appVersion: session.client.appVersion,
        legal: {
          terms: publicPageUrl('/terms'),
          privacyPolicy: publicPageUrl('/privacy'),
          contentPolicy: publicPageUrl('/content-policy'),
        },
        supportEmail,
        logoutStatus: logout.status,
        onLogout: logout.run,
        onOpenLegal: openLegal,
        themeChoice,
        onContactSupport:
          supportEmail === null
            ? null
            : () => {
                void links.openMail(supportEmail);
              },
      };
    },
    online,
  );
  if (view.status !== 'ready') {
    return view;
  }
  if (view.data === null) {
    return { status: 'loading' };
  }
  return { ...view, data: view.data };
}
