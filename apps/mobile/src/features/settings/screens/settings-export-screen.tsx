import { assertNever } from '@citizenrun/shared';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { ReauthSheet } from '@/features/auth';
import { errorText } from '@/features/settings/components/error-text';
import { exportState } from '@/features/settings/components/export-state';
import type { ExportScreenState } from '@/features/settings/components/export-state';
import { instantDateTime } from '@/features/settings/components/instant-text';
import { SettingsFooter, SettingsFrame } from '@/features/settings/components/settings-frame';
import type { SettingsFooterProps } from '@/features/settings/components/settings-frame';
import { SETTINGS_NAMESPACES } from '@/features/settings/components/settings-translation';
import type { SettingsExportViewModel } from '@/features/settings/view-models/settings-export.types';
import { useSettingsExportViewModel } from '@/features/settings/view-models/use-settings-export-view-model';
import { useNow } from '@/lib/now';
import { head } from '@/platform/head';
import { ListRow } from '@/ui/components/list-row';
import { Notice } from '@/ui/components/notice';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

type ExportData = Extract<SettingsExportViewModel, { status: 'ready' }>['data'];

const BLOCK: ViewStyle = { marginTop: space.x6 };

/**
 * SCR-settings-export: ask for a copy of the account's data, wait while it is built, and fetch it
 * while it is kept. Asking and fetching both need a fresh sign-in, which the sheet takes.
 */
export function SettingsExportScreenView({ vm }: { vm: SettingsExportViewModel }): JSX.Element {
  const { t, i18n } = useTranslation(SETTINGS_NAMESPACES);
  const now = useNow();

  /** An instant as the day and the time where the device is. */
  const timeOf = (iso: string): string =>
    instantDateTime(iso, i18n.language) ?? t('common:notKnownYet');

  const blockOf = (state: ExportScreenState): ReactNode => {
    switch (state.kind) {
      case 'none':
      case 'wait':
        return null;
      case 'queued':
        return <Notice kind="info" text={t('settings:export.queued')} />;
      case 'ready':
        return (
          <ListRow
            title={t('settings:export.readyUntil', { time: timeOf(state.until) })}
            size="compact"
            divider={false}
            testID="settings.export-ready"
          />
        );
      case 'expired':
        return <Notice kind="info" text={t('settings:export.expired')} />;
      case 'failed':
        return <Notice kind="error" text={t('settings:export.failed')} />;
      default:
        return assertNever(state);
    }
  };

  const buttonOf = (
    data: ExportData,
    state: ExportScreenState,
    stale: boolean,
  ): SettingsFooterProps['button'] => {
    if (state.kind === 'ready') {
      return stale
        ? {
            label: t('common:states.offlineAction'),
            disabled: true,
            testID: 'settings.export-download',
          }
        : {
            label: t('settings:export.download'),
            onPress: data.onDownload,
            busy: data.downloading,
            testID: 'settings.export-download',
          };
    }
    if (stale) {
      return {
        label: t('common:states.offlineAction'),
        disabled: true,
        testID: 'settings.export-request',
      };
    }
    switch (state.kind) {
      case 'queued':
        return {
          label: t('settings:export.building'),
          disabled: true,
          testID: 'settings.export-request',
        };
      case 'wait':
        return {
          label: t('settings:export.waitUntil', { time: timeOf(state.until) }),
          disabled: true,
          testID: 'settings.export-request',
        };
      case 'none':
      case 'expired':
      case 'failed':
        return {
          label: t('settings:export.request'),
          onPress: data.onRequest,
          busy: data.requesting,
          testID: 'settings.export-request',
        };
      default:
        return assertNever(state);
    }
  };

  return (
    <SettingsFrame
      state={vm}
      title={t('settings:row.export')}
      parentHref="/settings"
      firstGroup={null}
      testID="settings.export"
      footer={(data, stale) => (
        <SettingsFooter
          error={data.errorCode === null ? null : errorText(data.errorCode, t)}
          button={buttonOf(data, exportState(data.status, now), stale)}
        />
      )}
    >
      {(data) => {
        const block = blockOf(exportState(data.status, now));
        return (
          <>
            <Text role="body">{t('settings:export.body')}</Text>
            {block === null ? null : <View style={BLOCK}>{block}</View>}
            <ReauthSheet vm={data.reauth} />
          </>
        );
      }}
    </SettingsFrame>
  );
}

export function SettingsExportScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const vm = useSettingsExportViewModel();
  return (
    <>
      <head.Title>{t('common:documentTitle', { title: t('settings:row.export') })}</head.Title>
      <SettingsExportScreenView vm={vm} />
    </>
  );
}
