import { QueryClientProvider } from '@tanstack/react-query';
import { Stack, useSegments } from 'expo-router';
import { I18nextProvider } from 'react-i18next';

import { routePattern } from '@/lib/client-errors';
import { getI18n } from '@/lib/i18n';
import { RootErrorBoundary } from '@/lib/root-error-boundary';
import { useStartup } from '@/lib/startup';
import { queryClient } from '@/platform/query-client';

export default function RootLayout() {
  const segments = useSegments();
  const { booted, updateRequired } = useStartup();
  if (!booted) return null; // storage has not hydrated
  return (
    <RootErrorBoundary route={routePattern(segments)} fallback={renderNothing}>
      <I18nextProvider i18n={getI18n()}>
        <QueryClientProvider client={queryClient.get()}>
          {updateRequired ? null : <Stack screenOptions={{ headerShown: false }} />}
        </QueryClientProvider>
      </I18nextProvider>
    </RootErrorBoundary>
  );
}

function renderNothing(): null {
  return null;
}
