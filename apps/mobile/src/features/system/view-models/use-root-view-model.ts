import { onlineManager } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useState } from 'react';

import { assertRouterPath } from '@/lib/router-path';
import { useStartup } from '@/lib/startup';
import { links } from '@/platform/links';
import { storage } from '@/platform/storage';
import { FONT_FACES } from '@/ui/fonts';

import { buildRootViewModel, navTargetFor } from './root.build';
import type { NavItem, RootViewModel } from './root.types';

// No session exists yet: `signedIn` is true once a session exists and `Me` has loaded.
const SIGNED_IN = false;

/** The root layout's values: boot, theme, fonts, the system screen and the shell (SCR-root-layout). */
export function useRootViewModel(): RootViewModel {
  const { booted, updateRequired } = useStartup();
  const pathname = usePathname();
  const fontsReady = useFontsReadyAnswer();

  // storage.get throws until hydrate() has resolved, which `booted` follows.
  const storedTheme = useMemo(() => (booted ? storage.get('theme') : null), [booted]);

  useEffect(() => {
    if (booted) void SplashScreen.hideAsync();
  }, [booted]);

  return buildRootViewModel(
    {
      pathname,
      hydrated: booted,
      storedTheme,
      fontsReady,
      upgradeBlocked: updateRequired,
      signedIn: SIGNED_IN,
    },
    { onNavigate, onReselect },
  );
}

function onNavigate(item: NavItem): void {
  if (item === 'home') {
    router.navigate('/');
    return;
  }
  const target = navTargetFor(item, SIGNED_IN);
  assertRouterPath(target); // the generated route types cannot name a path built at run time
  router.push(target);
}

/** Dismisses every pushed route above the tab; the scroll to the top is signalled by the shell before this. */
function onReselect(): void {
  if (router.canDismiss()) router.dismissAll();
}

/**
 * Asks once whether the four faces have loaded and, after a false answer, again each time the network
 * comes back, until one answer is true. This is the one feature subscription to onlineManager (PM-links).
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
          return;
        }
        unsubscribe ??= onlineManager.subscribe((isOnline) => {
          if (isOnline) ask();
        });
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
