import type { Me } from '@citizenrun/shared';

import { useMe } from '@/features/system';
import { useIsOnline, viewStateOf } from '@/lib/view-models/query';

import type { SettingsPrivacyViewModel } from './settings-privacy.types';

/** SCR-settings-privacy: read from Me; it holds no control yet. */
export function useSettingsPrivacyViewModel(): SettingsPrivacyViewModel {
  const { me, source } = useMe();
  const online = useIsOnline();

  const view = viewStateOf<Me | null>([source], () => me, online);
  if (view.status !== 'ready') {
    return view;
  }
  if (view.data === null) {
    return { status: 'loading' };
  }
  return { ...view, data: { me: view.data } };
}
