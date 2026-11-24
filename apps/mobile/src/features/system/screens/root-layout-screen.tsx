import type { JSX, ReactElement, ReactNode } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { RootViewModel } from '@/features/system/view-models/root.types';
import { AppShell } from '@/ui/shells/app-shell';
import { useTheme } from '@/ui/theme';
import { z } from '@/ui/tokens';

export type RootLayoutScreenViewProps = {
  vm: RootViewModel;
  /** Drawn while `vm.system` is not null. */
  systemScreen: ReactElement;
  /** The root stack. */
  children: ReactNode;
};

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
 * stays mounted from then on; a system screen covers it, and the covered stack is out of reach of
 * touch and of a screen reader.
 */
export function RootLayoutScreenView({
  vm,
  systemScreen,
  children,
}: RootLayoutScreenViewProps): JSX.Element {
  const theme = useTheme();
  const covered = vm.system !== null;
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
      <View
        style={STACK}
        aria-hidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
        pointerEvents={covered ? 'none' : 'auto'}
      >
        {vm.boot === 'ready' ? children : null}
      </View>
      {covered ? (
        <View style={[COVER, { backgroundColor: theme.color.bg }]}>{systemScreen}</View>
      ) : null}
    </AppShell>
  );
}
