import { QueryClientProvider } from '@tanstack/react-query';
import {
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
  useSegments,
} from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';

import {
  AdultsOnlyScreen,
  AgreementsScreen,
  RootLayoutScreenView,
  SystemErrorScreenView,
  SystemUpdateScreen,
  useNavigationGuard,
  useRootViewModel,
} from '@/features/system';
import { routePattern } from '@/lib/client-errors';
import { getI18n } from '@/lib/i18n';
import { RootErrorBoundary } from '@/lib/root-error-boundary';
import { links } from '@/platform/links';
import type { PageKeyEvent } from '@/platform/links';
import { queryClient } from '@/platform/query-client';
import { ToastHost } from '@/ui/components/toast';
import { FontsProvider } from '@/ui/fonts';
import { useNavigatorTheme } from '@/ui/shells/navigator-theme';
import { ShortcutProvider } from '@/ui/shortcuts';
import { ThemeProvider } from '@/ui/theme';

// The native splash stays up until storage and the session have been read.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const segments = useSegments();
  const vm = useRootViewModel();
  // D-195
  useEffect(() => {
    if (vm.boot === 'ready') void SplashScreen.hideAsync();
  }, [vm.boot]);
  // One system screen at a time: two take the navigator's place, and the third is a sheet over it.
  const systemScreen =
    vm.system === 'update' ? (
      <SystemUpdateScreen />
    ) : vm.system === 'adultsOnly' ? (
      <AdultsOnlyScreen />
    ) : null;
  const overlay = vm.system === 'agreements' ? <AgreementsScreen /> : null;
  return (
    <RootErrorBoundary
      route={routePattern(segments)}
      fallback={({ onRetry }) => <ErrorFallback onRetry={onRetry} />}
    >
      <I18nextProvider i18n={getI18n()}>
        <QueryClientProvider client={queryClient.get()}>
          <ThemeProvider choice={vm.themeChoice}>
            <FontsProvider ready={vm.fontsReady}>
              <ShortcutProvider subscribeKeyDown={subscribeKeyDown}>
                <ToastHost>
                  <RootLayoutScreenView vm={vm} systemScreen={systemScreen} overlay={overlay}>
                    <NavigationGuard />
                    <RootStack />
                  </RootLayoutScreenView>
                </ToastHost>
              </ShortcutProvider>
            </FontsProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </I18nextProvider>
    </RootErrorBoundary>
  );
}

/** Turns the guard's redirects on. It reads the query cache and the router, so it stands inside both. */
function NavigationGuard(): null {
  useNavigationGuard();
  return null;
}

/**
 * The root stack. Every navigator under it takes its ground from the theme, so a route that paints
 * none of its own stands on `bg` and not on the navigation library's gray.
 */
function RootStack() {
  const navigatorTheme = useNavigatorTheme(DefaultTheme);
  return (
    <NavigationThemeProvider value={navigatorTheme}>
      <Stack screenOptions={{ headerShown: false, animation: 'default' }} />
    </NavigationThemeProvider>
  );
}

/** SCR-system-error. The boundary stands outside every provider, so this brings the two it reads. */
function ErrorFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <I18nextProvider i18n={getI18n()}>
      <ThemeProvider choice="system">
        <SystemErrorScreenView vm={{ onRetry }} />
      </ThemeProvider>
    </I18nextProvider>
  );
}

/** The platform's key subscription, as a stable function the shortcut provider can hold. */
function subscribeKeyDown(listener: (event: PageKeyEvent) => void): () => void {
  return links.subscribeKeyDown(listener);
}
