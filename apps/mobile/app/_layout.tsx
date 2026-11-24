import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import { routePattern } from '@/lib/client-errors';
import { getI18n } from '@/lib/i18n';
import { RootErrorBoundary } from '@/lib/root-error-boundary';
import { useStartup } from '@/lib/startup';
import { links } from '@/platform/links';
import type { PageKeyEvent } from '@/platform/links';
import { queryClient } from '@/platform/query-client';
import { storage } from '@/platform/storage';
import { FONT_FACES, FontsProvider } from '@/ui/fonts';
import { ShortcutProvider } from '@/ui/shortcuts';
import { ThemeProvider } from '@/ui/theme';
import type { ThemeChoice } from '@/ui/theme';

export default function RootLayout() {
  const segments = useSegments();
  const { booted, updateRequired } = useStartup();
  if (!booted) return null; // storage has not hydrated
  return (
    <RootErrorBoundary route={routePattern(segments)} fallback={renderNothing}>
      <I18nextProvider i18n={getI18n()}>
        <QueryClientProvider client={queryClient.get()}>
          <DesignProviders>
            {updateRequired ? null : <Stack screenOptions={{ headerShown: false }} />}
          </DesignProviders>
        </QueryClientProvider>
      </I18nextProvider>
    </RootErrorBoundary>
  );
}

/** The theme, fonts and shortcut providers. Rendered only after storage has hydrated. */
function DesignProviders({ children }: { children: ReactNode }) {
  const [themeChoice] = useState<ThemeChoice>(() => storage.get('theme') ?? 'system');
  const fontsReady = useFontsReadyAnswer();
  return (
    <ThemeProvider choice={themeChoice}>
      <FontsProvider ready={fontsReady}>
        <ShortcutProvider subscribeKeyDown={subscribeKeyDown}>{children}</ShortcutProvider>
      </FontsProvider>
    </ThemeProvider>
  );
}

/**
 * Asks the platform once whether the four faces have loaded, and again each time the network comes
 * back after a false answer, until one answer is true. No timeout: a face that never loads stays false.
 */
function useFontsReadyAnswer(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    let done = false;
    let unsubscribe: (() => void) | null = null;
    const stopListening = (): void => {
      unsubscribe?.();
      unsubscribe = null;
    };
    const ask = (): void => {
      void links.fontsReady(FONT_FACES).then((answer) => {
        if (!active || done) return;
        if (answer) {
          done = true;
          setReady(true);
          stopListening();
        } else {
          unsubscribe ??= onlineManager.subscribe((isOnline) => {
            if (isOnline) ask();
          });
        }
      });
    };
    ask();
    return () => {
      active = false;
      stopListening();
    };
  }, []);
  return ready;
}

/** The platform's key subscription, as a stable function the shortcut provider can hold. */
function subscribeKeyDown(listener: (event: PageKeyEvent) => void): () => void {
  return links.subscribeKeyDown(listener);
}

function renderNothing(): null {
  return null;
}
