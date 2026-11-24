import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import type { SystemUpdateViewModel } from '@/features/system/view-models/system-update.types';
import { useSystemUpdateViewModel } from '@/features/system/view-models/use-system-update-view-model';
import { SystemScreen } from '@/ui/components/system-screen';

/**
 * SCR-system-update: this version can no longer talk to the service. Nothing closes the screen;
 * "Update" is offered only where a store can deliver one.
 */
export function SystemUpdateScreenView({ vm }: { vm: SystemUpdateViewModel }): JSX.Element {
  const { t } = useTranslation(['system']);
  if (!vm.storeSupported) {
    return (
      <SystemScreen
        testID="system.update"
        title={t('system:update.title')}
        body={t('system:update.bodyNoStore')}
      />
    );
  }
  return (
    <SystemScreen
      testID="system.update"
      title={t('system:update.title')}
      body={t('system:update.body')}
      action={{
        label: t('system:update.action'),
        onPress: vm.onOpenStore,
        variant: 'primary',
        testID: 'system.update-action',
      }}
    />
  );
}

export function SystemUpdateScreen(): JSX.Element {
  return <SystemUpdateScreenView vm={useSystemUpdateViewModel()} />;
}
