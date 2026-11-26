import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { errorText } from '@/features/settings/components/error-text';
import { SettingsFrame } from '@/features/settings/components/settings-frame';
import { SETTINGS_NAMESPACES } from '@/features/settings/components/settings-translation';
import { useToastOn } from '@/features/settings/components/use-toast-on';
import type { SettingsPrivacyViewModel } from '@/features/settings/view-models/settings-privacy.types';
import { useSettingsPrivacyViewModel } from '@/features/settings/view-models/use-settings-privacy-view-model';
import { head } from '@/platform/head';
import { Switch } from '@/ui/components/switch';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

const CONTROL: ViewStyle = { marginTop: space.x6 };
const OFF_NOTE: ViewStyle = { marginTop: space.x2 };

/**
 * SCR-settings-privacy: the privacy choices. The switch shows the saved answer: it waits while a
 * change is on its way and stays where it was when the change fails, which a toast says.
 */
export function SettingsPrivacyScreenView({ vm }: { vm: SettingsPrivacyViewModel }): JSX.Element {
  const { t } = useTranslation(SETTINGS_NAMESPACES);
  const failed = vm.status === 'ready' ? vm.data.errorCode : null;

  useToastOn(failed !== null, {
    kind: 'error',
    text: errorText(failed ?? 'generic', t),
  });

  return (
    <SettingsFrame
      state={vm}
      title={t('settings:row.privacy')}
      parentHref="/settings"
      firstGroup={null}
      testID="settings.privacy"
    >
      {(data, stale) => {
        const allowed = data.me.consents.aiScreening === 'granted';
        return (
          <>
            <Text role="caption" tone="secondary">
              {t('settings:privacy.intro')}
            </Text>
            <View style={CONTROL}>
              <Switch
                label={t('settings:privacy.ai')}
                helper={t('auth:ai.sentence')}
                value={allowed}
                busy={data.saving === 'aiScreening'}
                disabled={stale}
                onChange={data.onSetAiScreening}
                testID="settings.privacy-ai"
              />
            </View>
            {allowed ? null : (
              <View style={OFF_NOTE}>
                <Text role="caption" tone="secondary">
                  {t('settings:privacy.aiOff')}
                </Text>
              </View>
            )}
          </>
        );
      }}
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
