import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { ReauthSheet } from '@/features/auth';
import { errorText } from '@/features/settings/components/error-text';
import { SettingsFooter, SettingsFrame } from '@/features/settings/components/settings-frame';
import { SETTINGS_NAMESPACES } from '@/features/settings/components/settings-translation';
import { useToastOn } from '@/features/settings/components/use-toast-on';
import type { SettingsDeleteViewModel } from '@/features/settings/view-models/settings-delete-account.types';
import { useSettingsDeleteAccountViewModel } from '@/features/settings/view-models/use-settings-delete-account-view-model';
import { head } from '@/platform/head';
import { Dialog } from '@/ui/components/dialog';
import { Link } from '@/ui/components/link';
import { Prose } from '@/ui/components/prose';

/**
 * SCR-settings-delete-account: what deleting the account removes, what is kept and for how long
 * (CTL-35), then the one button, a confirming dialog and a fresh sign-in. A suspended account sees
 * the same screen.
 */
export function SettingsDeleteAccountScreenView({
  vm,
}: {
  vm: SettingsDeleteViewModel;
}): JSX.Element {
  const { t } = useTranslation(SETTINGS_NAMESPACES);
  const deleted = vm.status === 'ready' && vm.data.status === 'deleted';

  useToastOn(deleted, { kind: 'success', text: t('settings:delete.done') });

  return (
    <SettingsFrame
      state={vm}
      title={t('settings:row.deleteAccount')}
      parentHref="/settings"
      firstGroup={null}
      testID="settings.delete"
      footer={(data, stale) => (
        <SettingsFooter
          error={data.errorCode === null ? null : errorText(data.errorCode, t)}
          variant="destructive"
          button={
            stale
              ? {
                  label: t('common:states.offlineAction'),
                  disabled: true,
                  testID: 'settings.delete-action',
                }
              : {
                  label: t('settings:delete.action'),
                  onPress: data.onAskDelete,
                  busy: data.status === 'deleting' || data.status === 'deleted',
                  testID: 'settings.delete-action',
                }
          }
        />
      )}
    >
      {(data) => (
        <>
          <Prose
            blocks={[
              { kind: 'paragraph', text: t('settings:delete.intro') },
              { kind: 'paragraph', text: t('settings:delete.when') },
              { kind: 'paragraph', text: t('settings:delete.undo') },
              { kind: 'paragraph', text: t('settings:delete.threads') },
              { kind: 'heading', text: t('settings:delete.keptTitle') },
              {
                kind: 'list',
                ordered: false,
                items: [
                  t('settings:delete.keptHolds'),
                  t('settings:delete.keptReports'),
                  t('settings:delete.keptOpenReports'),
                  t('settings:delete.keptRecords'),
                  t('settings:delete.keptBan'),
                  t('settings:delete.keptBackups'),
                ],
              },
              {
                kind: 'paragraph',
                text: (
                  <Link href={data.exportHref} testID="settings.delete-export-first">
                    {t('settings:delete.exportFirst')}
                  </Link>
                ),
              },
            ]}
          />
          {/* The question waits behind the fresh sign-in: one layer asks at a time. */}
          <Dialog
            open={data.status === 'confirming' && !data.reauth.open}
            onClose={data.onCancel}
            title={t('settings:delete.confirmTitle')}
            {...(data.me.handle === null
              ? {}
              : { body: t('settings:delete.confirmBody', { handle: data.me.handle }) })}
            actions={[
              {
                label: t('common:cancel'),
                variant: 'quiet',
                onPress: data.onCancel,
                testID: 'settings.delete-cancel',
              },
              {
                label: t('settings:delete.confirm'),
                variant: 'destructive',
                onPress: data.onConfirm,
                testID: 'settings.delete-confirm',
              },
            ]}
            testID="settings.delete-dialog"
          />
          <ReauthSheet vm={data.reauth} />
        </>
      )}
    </SettingsFrame>
  );
}

export function SettingsDeleteAccountScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const vm = useSettingsDeleteAccountViewModel();
  return (
    <>
      <head.Title>
        {t('common:documentTitle', { title: t('settings:row.deleteAccount') })}
      </head.Title>
      <SettingsDeleteAccountScreenView vm={vm} />
    </>
  );
}
