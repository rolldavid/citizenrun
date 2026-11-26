import { noop } from '@/lib/view-models/__fixtures__/common';

import type { SettingsAppearanceViewModel } from './settings-appearance.types';

export const appearanceSystem = {
  choice: 'system',
  onChange: noop,
} satisfies SettingsAppearanceViewModel;

export const appearanceDark = {
  choice: 'dark',
  onChange: noop,
} satisfies SettingsAppearanceViewModel;
