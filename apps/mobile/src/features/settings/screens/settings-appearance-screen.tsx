import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsFrame } from '@/features/settings/components/settings-frame';
import { SETTINGS_NAMESPACES } from '@/features/settings/components/settings-translation';
import type { SettingsAppearanceViewModel } from '@/features/settings/view-models/settings-appearance.types';
import { useSettingsAppearanceViewModel } from '@/features/settings/view-models/use-settings-appearance-view-model';
import { head } from '@/platform/head';
import { RadioGroup } from '@/ui/components/radio-group';

/** SCR-settings-appearance: the theme. A choice changes the whole app's palette in one frame. */
export function SettingsAppearanceScreenView({
  vm,
}: {
  vm: SettingsAppearanceViewModel;
}): JSX.Element {
  const { t } = useTranslation(SETTINGS_NAMESPACES);
  return (
    <SettingsFrame
      state={{ status: 'ready', data: vm, refreshing: false, stale: false }}
      title={t('settings:row.appearance')}
      parentHref="/settings"
      firstGroup={null}
      testID="settings.appearance-screen"
    >
      {(data) => (
        <RadioGroup
          label={t('settings:appearance.label')}
          value={data.choice}
          options={[
            { value: 'system', label: t('settings:appearance.system') },
            { value: 'light', label: t('settings:appearance.light') },
            { value: 'dark', label: t('settings:appearance.dark') },
          ]}
          onChange={(value) => {
            if (value === 'system' || value === 'light' || value === 'dark') {
              data.onChange(value);
            }
          }}
          testID="settings.appearance"
        />
      )}
    </SettingsFrame>
  );
}

export function SettingsAppearanceScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const vm = useSettingsAppearanceViewModel();
  return (
    <>
      <head.Title>{t('common:documentTitle', { title: t('settings:row.appearance') })}</head.Title>
      <SettingsAppearanceScreenView vm={vm} />
    </>
  );
}
