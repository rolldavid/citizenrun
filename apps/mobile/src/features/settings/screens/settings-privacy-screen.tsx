import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingsFrame } from '@/features/settings/components/settings-frame';
import { SETTINGS_NAMESPACES } from '@/features/settings/components/settings-translation';
import type { SettingsPrivacyViewModel } from '@/features/settings/view-models/settings-privacy.types';
import { useSettingsPrivacyViewModel } from '@/features/settings/view-models/use-settings-privacy-view-model';
import { head } from '@/platform/head';
import { Text } from '@/ui/components/text';

/** SCR-settings-privacy: what the profile never shows. It asks nothing about AI screening (D-900). */
export function SettingsPrivacyScreenView({ vm }: { vm: SettingsPrivacyViewModel }): JSX.Element {
  const { t } = useTranslation(SETTINGS_NAMESPACES);

  return (
    <SettingsFrame
      state={vm}
      title={t('settings:row.privacy')}
      parentHref="/settings"
      firstGroup={null}
      testID="settings.privacy"
    >
      {() => (
        <Text role="caption" tone="secondary">
          {t('settings:privacy.intro')}
        </Text>
      )}
    </SettingsFrame>
  );
}

export function SettingsPrivacyScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const vm = useSettingsPrivacyViewModel();
  return (
    <>
      <head.Title>{t('common:documentTitle', { title: t('settings:row.privacy') })}</head.Title>
      <SettingsPrivacyScreenView vm={vm} />
    </>
  );
}
