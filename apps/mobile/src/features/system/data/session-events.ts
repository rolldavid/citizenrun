import { routeClassOf } from '@citizenrun/shared';

import { clearRememberedNext, currentPath, replaceWith, signInHref } from '@/lib/navigation';
import { setSessionPresence } from '@/lib/session-state';
import { links } from '@/platform/links';
import { session } from '@/platform/session';

import { setUpgradeBlocked } from './system-state';

let running: Promise<void> | null = null;

async function endSession(): Promise<void> {
  // Absent first, so the Me query stops before the session end empties the cache.
  setSessionPresence('absent');
  clearRememberedNext();
  await session.endLocal('unauthorized'); // CTL-11
  const path = currentPath();
  const routeClass = routeClassOf(path);
  if (routeClass !== 'public' && routeClass !== 'auth') {
    replaceWith(signInHref(path));
  }
}

/** Rule N4: ends the session on this device and opens sign-in unless the route is public or a sign-in route. */
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
