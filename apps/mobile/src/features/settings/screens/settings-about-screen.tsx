import { BRAND, assertNever } from '@citizenrun/shared';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { SettingsFrame } from '@/features/settings/components/settings-frame';
import { SETTINGS_NAMESPACES } from '@/features/settings/components/settings-translation';
import type { SettingsT } from '@/features/settings/components/settings-translation';
import type { SettingsAboutViewModel } from '@/features/settings/view-models/settings-about.types';
import { useSettingsAboutViewModel } from '@/features/settings/view-models/use-settings-about-view-model';
import { head } from '@/platform/head';
import { ListRow } from '@/ui/components/list-row';
import { Prose } from '@/ui/components/prose';
import { space } from '@/ui/tokens';

type AboutLink = SettingsAboutViewModel['links'][number];

const LINKS: ViewStyle = { marginTop: space.x1 };

/** A link row's title and the id it is found by; null for a link that has no row yet. */
function linkRow(id: AboutLink['id'], t: SettingsT): { title: string; testID: string } | null {
  switch (id) {
    case 'privacy':
      return { title: t('settings:row.privacyPolicy'), testID: 'settings.about-privacy' };
    case 'terms':
      return { title: t('settings:row.terms'), testID: 'settings.about-terms' };
    case 'contentPolicy':
      return { title: t('settings:row.contentPolicy'), testID: 'settings.about-content-policy' };
    case 'childSafety':
    case 'dmca':
    case 'credits':
    case 'support':
    case 'deleteAccount':
    case 'reportIntimateImage':
      return null;
    default:
      return assertNever(id);
  }
}

/**
 * SCR-settings-about: what the app is, the sentence that it is no government's, and the
 * policies. The page's own title is the screen's heading, so the app bar carries none.
 */
export function SettingsAboutScreenView({ vm }: { vm: SettingsAboutViewModel }): JSX.Element {
  const { t } = useTranslation(SETTINGS_NAMESPACES);
  return (
    <SettingsFrame
      state={{ status: 'ready', data: vm, refreshing: false, stale: false }}
      title={null}
      parentHref="/settings"
      width="longForm"
      firstGroup={null}
      testID="settings.about"
    >
      {(data) => {
        const rows = data.links.flatMap((link) => {
          const row = linkRow(link.id, t);
          return row === null ? [] : [{ ...row, url: link.url }];
        });
        return (
          <>
            <Prose
              blocks={[
                { kind: 'title', text: BRAND.displayName },
                { kind: 'paragraph', text: t('settings:about.what') },
                { kind: 'paragraph', text: t('settings:about.notGovernment') },
                { kind: 'heading', text: t('settings:about.legalTitle') },
              ]}
            />
            <View style={LINKS}>
              {rows.map((row, index) => (
                <ListRow
                  key={row.testID}
                  title={row.title}
                  trailing={{ kind: 'chevron' }}
                  onPress={() => {
                    data.onOpen(row.url);
                  }}
                  divider={index < rows.length - 1}
                  testID={row.testID}
                />
              ))}
            </View>
          </>
        );
      }}
    </SettingsFrame>
  );
}

export function SettingsAboutScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const vm = useSettingsAboutViewModel();
  return (
    <>
      <head.Title>{t('common:documentTitle', { title: t('settings:row.about') })}</head.Title>
      <SettingsAboutScreenView vm={vm} />
    </>
  );
}
