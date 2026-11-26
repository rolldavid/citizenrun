import { routeClassOf } from '@citizenrun/shared';
import type { RouteClass } from '@citizenrun/shared';

import { clearRememberedNext, currentPath, replaceWith, signInHref } from '@/lib/navigation';
import { getSessionPresence, setSessionPresence } from '@/lib/session-state';
import { links } from '@/platform/links';
import { session } from '@/platform/session';

import { setUpgradeBlocked } from './system-state';

// Rule N4; a dev route stays whatever the session (SCR-root-layout guard row D).
const STAYS_SIGNED_OUT: ReadonlySet<RouteClass> = new Set(['public', 'auth', 'dev']);

let running: Promise<void> | null = null;

async function endSession(): Promise<void> {
  // 'unknown' means no session was seen in this page load (the web before E-ME-01 answers): there is
  // nothing on this device to end, and emptying the cache would strand the public queries in flight.
  const sessionSeen = getSessionPresence() !== 'unknown';
  // Absent first, so the Me query stops before the session end empties the cache.
  setSessionPresence('absent');
  clearRememberedNext();
  if (sessionSeen) {
    await session.endLocal('unauthorized'); // CTL-11
  }
  const path = currentPath();
  if (!STAYS_SIGNED_OUT.has(routeClassOf(path))) {
    replaceWith(signInHref(path));
  }
}

/**
 * Rule N4: ends the session on this device (when one was seen) and opens sign-in unless the route is
 * public, a sign-in route or a dev route.
 */
export function handleUnauthorized(): Promise<void> {
  running ??= endSession().finally(() => {
    running = null;
  });
  return running;
}

/** 00 section 6.12: the one reload on the web; the update screen when it answers false. */
export function handleUpgradeRequired(): void {
  if (!links.reloadOnce('upgrade_required')) {
    setUpgradeBlocked(true);
  }
}
