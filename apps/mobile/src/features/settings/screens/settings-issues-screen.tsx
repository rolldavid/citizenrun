import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { IssuesStepView } from '@/features/onboarding';
import { SETTINGS_NAMESPACES } from '@/features/settings/components/settings-translation';
import { useSettingsBack } from '@/features/settings/components/use-settings-back';
import { useToastOn } from '@/features/settings/components/use-toast-on';
import type { SettingsIssuesViewModel } from '@/features/settings/view-models/settings-issues.types';
import { useSettingsIssuesViewModel } from '@/features/settings/view-models/use-settings-issues-view-model';
import { head } from '@/platform/head';

/**
 * SCR-settings-issues: the issues step of sign-up under the settings app bar. A save that went
 * through says so and goes back to the list of settings.
 */
export function SettingsIssuesScreenView({ vm }: { vm: SettingsIssuesViewModel }): JSX.Element {
  const { t } = useTranslation(SETTINGS_NAMESPACES);
  const onBack = useSettingsBack('/settings');
  const saved = vm.status === 'ready' && vm.data.submit.status === 'saved';

  useToastOn(saved, { kind: 'success', text: t('settings:issues.saved') });

  // The view-model's way back, as the latest render has it.
  const leave = useRef<(() => void) | null>(null);
  useEffect(() => {
    leave.current = vm.status === 'ready' ? vm.data.onBack : null;
  });
  // After the toast: back once for each save that went through.
  const left = useRef(false);
  useEffect(() => {
    if (saved && !left.current) {
      leave.current?.();
    }
    left.current = saved;
  }, [saved]);

  return (
    <IssuesStepView
      vm={vm}
      appBar={{ variant: 'screen', title: t('settings:issues.title'), onBack }}
      heading={null}
      groupLabel={t('settings:issues.title')}
      helper={t('onboarding:issues.body')}
      primaryLabel={t('common:save')}
      showChangeLater={false}
      testIDs={{
        screen: 'settings.issues',
        primary: 'settings.issues-save',
        grid: 'onboarding.issue',
      }}
    />
  );
}

export function SettingsIssuesScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const vm = useSettingsIssuesViewModel();
  return (
    <>
      <head.Title>{t('common:documentTitle', { title: t('settings:issues.title') })}</head.Title>
      <SettingsIssuesScreenView vm={vm} />
    </>
  );
}
