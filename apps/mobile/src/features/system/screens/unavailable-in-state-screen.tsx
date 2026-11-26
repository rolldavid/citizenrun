import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { stateNameKey } from '@/features/system/components/state-name';
import type { StateUnavailableViewModel } from '@/features/system/view-models/state-unavailable.types';
import { navigateTo } from '@/lib/navigation';
import { SystemScreen } from '@/ui/components/system-screen';

/**
 * SCR-system-unavailable-in-state: the app is not offered where the person lives yet (D-463). It
 * names the state when it knows it, and leads to what can still be read. A screen that meets the
 * refusal draws this in place of its own content.
 */
export function UnavailableInStateScreenView({
  vm,
}: {
  vm: StateUnavailableViewModel;
}): JSX.Element {
  const { t } = useTranslation(['system', 'common']);
  const { browseHref, deleteHref } = vm;
  const nameKey = vm.stateCode === null ? null : stateNameKey(vm.stateCode);
  return (
    <SystemScreen
      testID="system.state-unavailable"
      title={
        nameKey === null
          ? t('system:stateUnavailable.titleGeneric')
          : t('system:stateUnavailable.title', { state: t(nameKey) })
      }
      body={t('system:stateUnavailable.body')}
      action={{
        label: t('system:stateUnavailable.browse'),
        onPress: () => {
          navigateTo(browseHref);
        },
        variant: 'secondary',
        testID: 'system.state-unavailable-browse',
      }}
      {...(vm.signedIn && deleteHref !== null
        ? {
            secondaryAction: {
              label: t('system:stateUnavailable.delete'),
              onPress: () => {
                navigateTo(deleteHref);
              },
              testID: 'system.state-unavailable-delete',
            },
          }
        : {})}
    />
  );
}
