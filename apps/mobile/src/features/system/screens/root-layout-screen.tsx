import { createContext, useContext, useMemo } from 'react';
import type { JSX, ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { RootViewModel } from '@/features/system/view-models/root.types';
import { AppShell } from '@/ui/shells/app-shell';
import type { NavItemId } from '@/ui/shells/app-shell';
import { useTheme } from '@/ui/theme';
import { z } from '@/ui/tokens';

export type RootLayoutScreenViewProps = {
  vm: RootViewModel;
  /** Drawn over a hidden stack: a system screen that takes the navigator's place, or null. */
  systemScreen: ReactElement | null;
  /** Drawn over the visible stack: a system screen that is a sheet, or null. */
  overlay: ReactElement | null;
  /** The root stack. */
  children: ReactNode;
};

/** What the tab navigator's bar reads of the root layout. */
export type RootNav = {
  active: NavItemId | null;
  onNavigate: (item: NavItemId) => void;
  onReselect: (item: NavItemId) => void;
  unreadActivity: number;
};

const RootNavContext = createContext<RootNav | null>(null);

function stay(): void {
  // nothing to do
}

/** What a build for people reads outside the root layout: a bar that leads nowhere. */
const NO_NAV: RootNav = { active: null, onNavigate: stay, onReselect: stay, unreadActivity: 0 };

/** The root layout's navigation values. Outside the root layout it throws in development. */
export function useRootNav(): RootNav {
  const nav = useContext(RootNavContext);
  if (nav === null) {
    if (__DEV__) {
      throw new Error('useRootNav is read outside the root layout');
    }
    return NO_NAV;
  }
  return nav;
}

const STACK: ViewStyle = { flex: 1 };
// Over the whole content slot, above anything a screen under it draws.
const COVER: ViewStyle = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: z.overlay,
};

/**
 * SCR-root-layout: the shell around the root stack. The stack mounts once the app has started and
 * stays mounted from then on. A system screen that takes its place covers it, and the covered
 * stack is out of reach of touch and of a screen reader; one that is a sheet lies over a stack
 * that stays in view, and is modal by itself.
 */
export function RootLayoutScreenView({
  vm,
  systemScreen,
  overlay,
  children,
}: RootLayoutScreenViewProps): JSX.Element {
  const theme = useTheme();
  const covered = systemScreen !== null;
  const { active, unread } = vm.shell;
  const { onNavigate, onReselect } = vm;
  const nav = useMemo<RootNav>(
    () => ({ active, onNavigate, onReselect, unreadActivity: unread.activity }),
    [active, onNavigate, onReselect, unread.activity],
  );
  return (
    <AppShell
      mode={covered ? 'bare' : vm.shell.mode}
      active={vm.shell.active}
      onNavigate={vm.onNavigate}
      onReselect={vm.onReselect}
      unread={vm.shell.unread}
      place={vm.shell.place}
      topBar={null}
      banner={null}
      signedIn={vm.shell.signedIn}
    >
      <RootNavContext.Provider value={nav}>
        <View
          style={STACK}
          aria-hidden={covered}
          importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
          pointerEvents={covered ? 'none' : 'auto'}
        >
          {vm.boot === 'ready' ? children : null}
        </View>
        {systemScreen === null ? null : (
          <View style={[COVER, { backgroundColor: theme.color.bg }]}>{systemScreen}</View>
        )}
        {overlay}
      </RootNavContext.Provider>
    </AppShell>
  );
}
