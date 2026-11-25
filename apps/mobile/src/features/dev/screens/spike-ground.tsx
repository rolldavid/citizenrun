import type { JSX } from 'react';
import { View } from 'react-native';

import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { size } from '@/ui/tokens';

/**
 * The ground of a spike that chooses its own theme, drawn out to the edges of the window. The shell
 * holds a screen to `size.contentMax` and paints the margins at each side in the app's theme; a
 * spike in another theme lays its own ground over them. It is the first child of the spike's theme,
 * so the screen is drawn over it. It draws nothing in a window the screen fills.
 */
export function SpikeGround(): JSX.Element | null {
  const theme = useTheme();
  const { width } = useBreakpoint();
  const margin = (width - Math.min(width, size.contentMax)) / 2;
  if (margin <= 0) {
    return null;
  }
  return (
    <View
      testID="dev.spike-ground"
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: -margin,
        right: -margin,
        backgroundColor: theme.color.bg,
      }}
    />
  );
}
