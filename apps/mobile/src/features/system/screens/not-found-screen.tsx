import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';

import { head } from '@/platform/head';
import { EmptyState } from '@/ui/components/empty-state';
import { Screen } from '@/ui/components/screen';

/** SCR-not-found: the content of every path no route matches. Its one step leads Home. */
export function NotFoundScreenView(): JSX.Element {
  const { t } = useTranslation(['system']);
  return (
    <Screen width="column" appBar={null} testID="system.not-found">
      <EmptyState
        kind="empty"
        art="chair"
        headingLevel={1}
        title={t('system:notFound.title')}
        body={t('system:notFound.body')}
        action={{
          label: t('system:notFound.action'),
          href: '/',
          variant: 'primary',
          testID: 'system.not-found-home',
        }}
      />
    </Screen>
  );
}

export function NotFoundScreen(): JSX.Element {
  const { t } = useTranslation(['common']);
  return (
    <>
      <head.Title>{t('common:notFound.title')}</head.Title>
      <NotFoundScreenView />
    </>
  );
}
