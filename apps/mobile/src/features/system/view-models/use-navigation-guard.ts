import { useEffect } from 'react';

import { isAtLocation, replaceWith } from '@/lib/navigation';

import { useMinorEnded, useUpgradeBlocked } from '../data/system-state';

import { useGuardState } from './guard-state';

/** Applies the guard's redirects (SCR-root-layout guards); the root layout calls it once. */
export function useNavigationGuard(): void {
  const { result, path, next, boot, navigatorReady } = useGuardState();
  const upgradeBlocked = useUpgradeBlocked();
  const minorEnded = useMinorEnded();
  const target = result.kind === 'redirect' ? result.to : null;

  useEffect(() => {
    if (boot !== 'ready' || !navigatorReady || upgradeBlocked || minorEnded) return;
    if (target === null || isAtLocation(target, path, next)) return;
    replaceWith(target);
  }, [target, path, next, boot, navigatorReady, upgradeBlocked, minorEnded]);
}
