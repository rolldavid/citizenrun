import { routeClassOf } from '@citizenrun/shared';
import type { Me, RouteClass } from '@citizenrun/shared';
import Constants from 'expo-constants';
import { useGlobalSearchParams, usePathname, useRootNavigationState } from 'expo-router';
import { useEffect } from 'react';

import { markNavigationReady, peekRememberedNext, resolveGuard } from '@/lib/navigation';
import type { GuardInput, GuardResult } from '@/lib/navigation';
import { useSessionPresence } from '@/lib/session-state';
import type { SessionPresence } from '@/platform/session';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';

import { useMe } from '../data/me';
import { useBoot, useUpgradeBlocked } from '../data/system-state';
import type { BootState } from '../data/system-state';

import { guardSessionOf } from './root.build';

export type GuardState = {
  path: string;
  next: string | null;
  routeClass: RouteClass;
  presence: SessionPresence;
  me: Me | null;
  boot: BootState;
  navigatorReady: boolean;
  input: GuardInput;
  result: GuardResult;
};

function firstString(value: string | readonly string[] | undefined): string | null {
  if (typeof value === 'string') return value;
  return value?.[0] ?? null;
}

/** The root navigator's state has no key until the navigator has mounted. */
function hasMounted(state: { key?: string } | undefined): boolean {
  return state?.key !== undefined;
}

/** The guard's input as the app stands, and its answer (SCR-root-layout guards). */
export function useGuardState(): GuardState {
  const path = usePathname();
  const next = firstString(useGlobalSearchParams().next);
  const presence = useSessionPresence();
  const { me } = useMe();
  const boot = useBoot();
  const upgradeBlocked = useUpgradeBlocked();
  const { breakpoint } = useBreakpoint();
  const navigatorReady = hasMounted(useRootNavigationState());
  const variant: unknown = Constants.expoConfig?.extra?.variant;

  const input: GuardInput = {
    path,
    next,
    rememberedNext: peekRememberedNext(),
    session: guardSessionOf(presence, me),
    upgradeBlocked,
    landingPageSupported: false,
    revealShowing: false,
    breakpoint,
    devRoutesAllowed: variant !== 'production',
  };

  useEffect(() => {
    if (navigatorReady) markNavigationReady();
  }, [navigatorReady]);

  return {
    path,
    next,
    routeClass: routeClassOf(path),
    presence,
    me,
    boot,
    navigatorReady,
    input,
    result: resolveGuard(input),
  };
}
