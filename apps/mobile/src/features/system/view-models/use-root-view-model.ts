import { onlineManager } from '@tanstack/react-query';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';

import { reportClientError } from '@/lib/client-errors';
import {
  clearRememberedNext,
  dismissTo,
  navigateTo,
  navTargetFor,
  rememberTabItem,
  tabItemOf,
  tabRootFor,
  trackCurrentPath,
} from '@/lib/navigation';
import { getSessionPresence, setSessionPresence } from '@/lib/session-state';
import { links } from '@/platform/links';
import { queryClient } from '@/platform/query-client';
import { session } from '@/platform/session';
import { storage } from '@/platform/storage';
import { FONT_FACES } from '@/ui/fonts';

import { runColdStartAgeCheck } from '../data/age-signal';
import { handleUnauthorized, handleUpgradeRequired } from '../data/session-events';
import {
  markStorageHydrated,
  setBoot,
  useBoot,
  useMinorEnded,
  useThemeChoice,
  useUpgradeBlocked,
} from '../data/system-state';

import { useGuardState } from './guard-state';
import { buildShell, guardSessionOf, systemScreenFor } from './root.build';
import type { NavItem, RootViewModel } from './root.types';

/** The root layout's values: boot, theme, fonts, the system screen and the shell (SCR-root-layout). */
export function useRootViewModel(): RootViewModel {
  const client = queryClient.get();
  useStartup();
  const boot = useBoot();
  const fontsReady = useFontsReadyAnswer();
  const g = useGuardState();
  const { path, me, routeClass } = g;

  useEffect(() => {
    if (boot === 'ready') void SplashScreen.hideAsync();
  }, [boot]);

  useEffect(() => {
    trackCurrentPath(path);
    const tab = tabItemOf(path);
    if (tab !== null) rememberTabItem(tab);
  }, [path]);

  // A loaded Me means a session exists.
  useEffect(() => {
    if (me !== null && getSessionPresence() !== 'present') setSessionPresence('present');
  }, [me]);

  // Rule N3: the person has landed.
  const landed =
    me?.onboardingStep === 'done' && routeClass !== 'auth' && routeClass !== 'onboarding';
  useEffect(() => {
    if (landed) clearRememberedNext();
  }, [landed, path]);

  // D-531: effects run after the first paint.
  const isReady = g.boot === 'ready';
  useEffect(() => {
    if (isReady && me !== null) void runColdStartAgeCheck(me, client);
  }, [isReady, me, client]);

  const system = systemScreenFor({
    upgradeBlocked: useUpgradeBlocked(),
    guard: g.result,
    minorEnded: useMinorEnded(),
    me,
    path,
  });
  const themeChoice = useThemeChoice();
  const shell = buildShell({ path, system, session: guardSessionOf(g.presence, me) });

  return {
    boot,
    themeChoice,
    fontsReady,
    system,
    shell,
    createDialogOpen: false,
    onNavigate: (item: NavItem) => {
      navigateTo(navTargetFor(item, shell.signedIn));
    },
    onReselect: (item: NavItem) => {
      dismissTo(tabRootFor(item));
    },
    onCloseCreateDialog: noop,
  };
}

function noop(): void {
  // the create dialog arrives with SCR-create
}

/** Starts the platform modules once, in the startup order of the platform modules. */
function useStartup(): void {
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, []);
}

async function start(): Promise<void> {
  try {
    await storage.hydrate();
    markStorageHydrated();
    session.configure({
      onUnauthorized: () => {
        void handleUnauthorized();
      },
      onUpgradeRequired: handleUpgradeRequired,
    });
    setSessionPresence(await session.hydrate());
    queryClient.get();
    queryClient.start();
  } catch (error) {
    // The app still renders, so its requests fail visibly instead of leaving a blank screen.
    reportClientError(error, { route: null, component: null }, 'app.startup_failed');
  }
  setBoot('ready');
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
