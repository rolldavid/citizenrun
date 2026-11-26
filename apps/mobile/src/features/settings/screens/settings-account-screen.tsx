import { assertNever } from '@citizenrun/shared';
import type { Me } from '@citizenrun/shared';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { AddEmailSheet } from '@/features/auth';
import { SettingsFrame, SettingsGroup } from '@/features/settings/components/settings-frame';
import { SETTINGS_NAMESPACES } from '@/features/settings/components/settings-translation';
import type { SettingsT } from '@/features/settings/components/settings-translation';
import type { SettingsAccountViewModel } from '@/features/settings/view-models/settings-account.types';
import { useSettingsAccountViewModel } from '@/features/settings/view-models/use-settings-account-view-model';
import { head } from '@/platform/head';
import { ListRow } from '@/ui/components/list-row';
import { Notice } from '@/ui/components/notice';
import { space } from '@/ui/tokens';

type SignInMethod = Me['signInMethods'][number];

const WARNING: ViewStyle = { marginTop: space.x3 };

/** A way of signing in, by its name and the id its row is found by. */
function methodRow(method: SignInMethod, t: SettingsT): { title: string; testID: string } {
  switch (method) {
    case 'email':
      return { title: t('settings:account.method.email'), testID: 'settings.account-method-email' };
    case 'apple':
      return { title: t('settings:account.method.apple'), testID: 'settings.account-method-apple' };
    case 'google':
      return {
        title: t('settings:account.method.google'),
        testID: 'settings.account-method-google',
      };
    default:
      return assertNever(method);
  }
}

/** SCR-settings-account: the account's email and the ways it signs in. */
export function SettingsAccountScreenView({ vm }: { vm: SettingsAccountViewModel }): JSX.Element {
  const { t } = useTranslation(SETTINGS_NAMESPACES);
  return (
    <SettingsFrame
      state={vm}
      title={t('settings:row.account')}
      parentHref="/settings"
      firstGroup={t('settings:account.email')}
      testID="settings.account"
    >
      {(data, stale) => {
        const { me } = data;
        return (
          <>
            <SettingsGroup label={t('settings:account.email')} first={true}>
              {me.email !== null ? (
                <ListRow
                  title={me.email}
                  size="compact"
                  divider={false}
                  testID="settings.account-email"
                />
              ) : stale ? (
                // Adding an email needs a connection: the row says so and takes no press.
                <ListRow
                  title={t('settings:account.addEmail')}
                  trailing={{ kind: 'value', text: t('common:states.offlineAction') }}
                  divider={false}
                  testID="settings.account-add-email"
                />
              ) : (
                <ListRow
                  title={t('settings:account.addEmail')}
                  trailing={{ kind: 'chevron' }}
                  onPress={data.onOpenAddEmail}
                  divider={false}
                  testID="settings.account-add-email"
                />
              )}
              {me.emailStatus === 'ok' ? null : (
                <View style={WARNING}>
                  <Notice
                    kind="warning"
                    text={t(`settings:account.emailStatus.${me.emailStatus}`)}
                  />
                </View>
              )}
            </SettingsGroup>
            <SettingsGroup label={t('settings:account.methods')}>
              {me.signInMethods.map((method, index) => {
                const row = methodRow(method, t);
                return (
                  <ListRow
                    key={method}
                    title={row.title}
                    size="compact"
                    divider={index < me.signInMethods.length - 1}
                    testID={row.testID}
                  />
                );
              })}
            </SettingsGroup>
            <AddEmailSheet
              title={t('settings:account.addEmail')}
              stage={data.addEmail.stage}
              email={data.addEmail.email}
              code={data.addEmail.code}
              onClose={data.onCloseAddEmail}
            />
          </>
        );
      }}
    </SettingsFrame>
  );
}

export function SettingsAccountScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const vm = useSettingsAccountViewModel();
  return (
    <>
      <head.Title>{t('common:documentTitle', { title: t('settings:row.account') })}</head.Title>
      <SettingsAccountScreenView vm={vm} />
    </>
  );
}
