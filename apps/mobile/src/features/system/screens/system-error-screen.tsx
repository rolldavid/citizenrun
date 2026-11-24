import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import type { SystemErrorViewModel } from '@/features/system/view-models/system-error.types';
import { SystemScreen } from '@/ui/components/system-screen';

/** SCR-system-error: what the root error boundary shows in place of a screen that failed to draw. */
export function SystemErrorScreenView({ vm }: { vm: SystemErrorViewModel }): JSX.Element {
  const { t } = useTranslation(['system', 'common']);
  return (
    <SystemScreen
      testID="system.error"
      title={t('system:error.title')}
      body={t('system:error.body')}
      action={{
        label: t('common:ui.retry'),
        onPress: vm.onRetry,
        variant: 'primary',
        testID: 'system.error-retry',
      }}
    />
  );
}
