import type { NavItem, RootViewModel, SystemScreenId } from './root.types';

export type RootInput = {
  pathname: string;
  hydrated: boolean;
  storedTheme: 'system' | 'light' | 'dark' | null;
  fontsReady: boolean;
  upgradeBlocked: boolean;
  signedIn: boolean;
};

/** The one path whose shell is `app`: SCR-hello. Every other path is a dev route or not found. */
const APP_PATH = '/';

/** Each navigation item's path (SCR-root-layout `onNavigate`). */
const NAV_PATHS = {
  home: '/',
  explore: '/explore',
  post: '/create',
  activity: '/activity',
  messages: '/messages',
  profile: '/profile',
} as const satisfies Record<NavItem, string>;

/** The system screen to draw, by the precedence of the system screens; only `update` exists so far. */
export function systemScreenFor(upgradeBlocked: boolean): SystemScreenId | null {
  return upgradeBlocked ? 'update' : null;
}

/** `bare` while a system screen shows and on every path but `/`. */
export function shellModeFor(pathname: string, system: SystemScreenId | null): 'app' | 'bare' {
  if (system !== null) return 'bare';
  return pathname === APP_PATH ? 'app' : 'bare';
}

/** `home` on `/` with no system screen; `null` on a direct load with no tab under it. */
export function activeItemFor(pathname: string, system: SystemScreenId | null): NavItem | null {
  return system === null && pathname === APP_PATH ? 'home' : null;
}

/** Where an item leads: its path when signed in; signed out, Home or sign-in with the path as `next` (D-520). */
export function navTargetFor(item: NavItem, signedIn: boolean): string {
  const path = NAV_PATHS[item];
  if (signedIn || item === 'home') return path;
  return '/sign-in?next=' + encodeURIComponent(path);
}

/** The root view-model from the startup, storage, fonts and route inputs. */
export function buildRootViewModel(
  input: RootInput,
  actions: { onNavigate: (item: NavItem) => void; onReselect: (item: NavItem) => void },
): RootViewModel {
  const system = systemScreenFor(input.upgradeBlocked);
  return {
    boot: input.hydrated ? 'ready' : 'starting',
    themeChoice: input.hydrated && input.storedTheme !== null ? input.storedTheme : 'system',
    fontsReady: input.fontsReady,
    system,
    shell: {
      mode: shellModeFor(input.pathname, system),
      active: activeItemFor(input.pathname, system),
      // Unread counts arrive with Activity and Messages, the place with districts.
      unread: { messages: 0, activity: 0 },
      place: null,
      signedIn: input.signedIn,
    },
    onNavigate: actions.onNavigate,
    onReselect: actions.onReselect,
  };
}
