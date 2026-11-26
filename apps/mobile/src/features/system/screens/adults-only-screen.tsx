import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import type { AdultsOnlyViewModel } from '@/features/system/view-models/adults-only.types';
import { useAdultsOnlyViewModel } from '@/features/system/view-models/use-adults-only-view-model';
import { SystemScreen } from '@/ui/components/system-screen';

/**
 * SCR-system-adults-only: one sentence and one way out. It states no age, asks nothing and offers
 * no way to answer again (CTL-75).
 */
export function AdultsOnlyScreenView({ vm }: { vm: AdultsOnlyViewModel }): JSX.Element {
  const { t } = useTranslation(['system', 'common']);
  return (
    <SystemScreen
      testID="system.adults-only"
      title={t('system:adultsOnly.title')}
      action={{
        label: t('common:close'),
        onPress: vm.onClose,
        variant: 'secondary',
        testID: 'system.adults-only-close',
      }}
    />
  );
}

export function AdultsOnlyScreen(): JSX.Element {
  return <AdultsOnlyScreenView vm={useAdultsOnlyViewModel()} />;
}
