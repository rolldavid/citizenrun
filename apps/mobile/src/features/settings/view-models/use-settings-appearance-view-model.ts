import { setThemeChoice, useThemeChoice } from '@/features/system';

import type { SettingsAppearanceViewModel } from './settings-appearance.types';

/** SCR-settings-appearance: the storage key theme; no request. */
export function useSettingsAppearanceViewModel(): SettingsAppearanceViewModel {
  const choice = useThemeChoice();
  return { choice, onChange: setThemeChoice };
}
