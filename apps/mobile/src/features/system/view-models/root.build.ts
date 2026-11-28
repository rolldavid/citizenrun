import type { Me } from '@citizenrun/shared';

import { activeItemFor, shellModeFor } from '@/lib/navigation';
import type { GuardResult, GuardSession } from '@/lib/navigation';
import type { SessionPresence } from '@/platform/session';

import type { RootViewModel, SystemScreenId } from './root.types';

// SCR-system-agreements
export const AGREEMENTS_EXEMPT_PATHS = ['/settings/delete-account', '/settings/export'] as const;

/**
 * The guard's session: none when no session exists, whatever Me is still cached; ready once Me loaded;
 * pending in between.
 */
export function guardSessionOf(presence: SessionPresence, me: Me | null): GuardSession {
  if (presence === 'absent') {
    return { kind: 'none' };
  }
  if (me !== null) {
    return { kind: 'ready', onboardingStep: me.onboardingStep, role: me.role };
  }
  return { kind: 'pending' };
}

// SCR-system-agreements
export function agreementsNeeded(me: Me | null, path: string): boolean {
  return (
    me !== null &&
    me.onboardingStep === 'done' &&
    me.consents.needed.length > 0 &&
    !AGREEMENTS_EXEMPT_PATHS.some((exempt) => exempt === path)
  );
}

/** The system screen to draw, by the precedence of the system screens. */
export function systemScreenFor(input: {
  upgradeBlocked: boolean;
  guard: GuardResult;
  minorEnded: boolean;
  me: Me | null;
  path: string;
}): SystemScreenId | null {
  const guardScreen = input.guard.kind === 'system' ? input.guard.screen : null;
  if (input.upgradeBlocked || guardScreen === 'update') return 'update';
  if (input.minorEnded) return 'adultsOnly';
  if (agreementsNeeded(input.me, input.path)) return 'agreements';
  return null;
}

/** AppShellProps; the agreements sheet sits over the navigator, so it keeps the shell. */
export function buildShell(input: {
  path: string;
  system: SystemScreenId | null;
  session: GuardSession;
}): RootViewModel['shell'] {
  const replacesNavigator = input.system === 'update' || input.system === 'adultsOnly';
  return {
    mode: shellModeFor(input.path, replacesNavigator),
    active: replacesNavigator ? null : activeItemFor(input.path),
    unread: { messages: 0, activity: 0 },
    place: null,
    signedIn: input.session.kind === 'ready',
    showGetAppBar: false,
    suspended: null,
  };
}
