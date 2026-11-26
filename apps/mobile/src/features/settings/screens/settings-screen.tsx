import { assertNever } from '@citizenrun/shared';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { SettingsFrame, SettingsGroup } from '@/features/settings/components/settings-frame';
import { SETTINGS_NAMESPACES } from '@/features/settings/components/settings-translation';
import type { SettingsT } from '@/features/settings/components/settings-translation';
import type { SettingsViewModel } from '@/features/settings/view-models/settings.types';
import { useSettingsViewModel } from '@/features/settings/view-models/use-settings-view-model';
import { head } from '@/platform/head';
import { Button } from '@/ui/components/button';
import { ListRow } from '@/ui/components/list-row';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

type SettingsData = Extract<SettingsViewModel, { status: 'ready' }>['data'];

const CHEVRON = { kind: 'chevron' } as const;

const WAY_OUT: ViewStyle = { marginTop: space.x8, alignItems: 'flex-start' };
const VERSION: ViewStyle = { marginTop: space.x4 };

/** The theme choice in words, as the Appearance screen names it. */
function themeText(choice: SettingsData['themeChoice'], t: SettingsT): string {
  switch (choice) {
    case 'system':
      return t('settings:appearance.system');
    case 'light':
      return t('settings:appearance.light');
    case 'dark':
      return t('settings:appearance.dark');
    default:
      return assertNever(choice);
  }
}

/** SCR-settings: the list of settings screens, the policies and the way out of the account. */
export function SettingsScreenView({ vm }: { vm: SettingsViewModel }): JSX.Element {
  const { t } = useTranslation(SETTINGS_NAMESPACES);
  return (
    <SettingsFrame
      state={vm}
      title={t('settings:title')}
      parentHref="/"
      firstGroup={t('settings:group.account')}
      testID="settings"
    >
      {(data) => (
        <>
          <SettingsGroup label={t('settings:group.account')} first={true}>
            <ListRow
              title={t('settings:row.profile')}
              trailing={CHEVRON}
              href="/settings/profile"
              testID="settings.row-profile"
            />
            <ListRow
              title={t('settings:issues.title')}
              trailing={CHEVRON}
              href="/settings/issues"
              testID="settings.row-issues"
            />
            <ListRow
              title={t('settings:row.account')}
              trailing={CHEVRON}
              href="/settings/account"
              divider={false}
              testID="settings.row-account"
            />
          </SettingsGroup>
          <SettingsGroup label={t('settings:group.alerts')}>
            {/* Drawn and not pressable until the notification settings exist. */}
            <ListRow
              title={t('settings:row.notifications')}
              trailing={{ kind: 'value', text: t('settings:soon') }}
              divider={false}
              testID="settings.row-notifications"
            />
          </SettingsGroup>
          <SettingsGroup label={t('settings:group.privacy')}>
            <ListRow
              title={t('settings:row.privacy')}
              trailing={CHEVRON}
              href="/settings/privacy"
              divider={false}
              testID="settings.row-privacy"
            />
          </SettingsGroup>
          <SettingsGroup label={t('settings:group.look')}>
            <ListRow
              title={t('settings:row.appearance')}
              trailing={{ kind: 'value', text: themeText(data.themeChoice, t) }}
              href="/settings/appearance"
              divider={false}
              testID="settings.row-appearance"
            />
          </SettingsGroup>
          <SettingsGroup label={t('settings:group.data')}>
            <ListRow
              title={t('settings:row.export')}
              trailing={CHEVRON}
              href="/settings/export"
              testID="settings.row-export"
            />
            <ListRow
              title={t('settings:row.deleteAccount')}
              trailing={CHEVRON}
              href="/settings/delete-account"
              destructive={true}
              divider={false}
              testID="settings.row-delete-account"
            />
          </SettingsGroup>
          <SettingsGroup label={t('settings:group.about')}>
            <ListRow
              title={t('settings:row.about')}
              trailing={CHEVRON}
              href="/settings/about"
              testID="settings.row-about"
            />
            <ListRow
              title={t('settings:row.terms')}
              trailing={CHEVRON}
              onPress={() => {
                data.onOpenLegal(data.legal.terms);
              }}
              testID="settings.row-terms"
            />
            <ListRow
              title={t('settings:row.privacyPolicy')}
              trailing={CHEVRON}
              onPress={() => {
                data.onOpenLegal(data.legal.privacyPolicy);
              }}
              testID="settings.row-privacy-policy"
            />
            <ListRow
              title={t('settings:row.contentPolicy')}
              trailing={CHEVRON}
              onPress={() => {
                data.onOpenLegal(data.legal.contentPolicy);
              }}
              divider={data.onContactSupport !== null}
              testID="settings.row-content-policy"
            />
            {data.onContactSupport === null ? null : (
              <ListRow
                title={t('settings:row.support')}
                trailing={CHEVRON}
                onPress={data.onContactSupport}
                divider={false}
                testID="settings.row-support"
              />
            )}
          </SettingsGroup>
          <View style={WAY_OUT}>
            <Button
              variant="secondary"
              label={t('settings:logout')}
              onPress={data.onLogout}
              busy={data.logoutStatus === 'sending'}
              testID="settings.logout"
            />
          </View>
          <View style={VERSION}>
            <Text role="mono" tone="secondary">
              {t('settings:version', { version: data.appVersion })}
            </Text>
          </View>
        </>
      )}
    </SettingsFrame>
  );
}

export function SettingsScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const vm = useSettingsViewModel();
  return (
    <>
      <head.Title>{t('common:documentTitle', { title: t('settings:title') })}</head.Title>
      <SettingsScreenView vm={vm} />
    </>
  );
}
