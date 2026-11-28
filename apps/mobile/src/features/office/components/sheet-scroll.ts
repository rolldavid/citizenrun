import type { ViewStyle } from 'react-native';

import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { size, space } from '@/ui/tokens';

// A long list scrolls inside its sheet and a short one takes its own height.
const SHRINKS: ViewStyle = { flexGrow: 0, flexShrink: 1 };

/** The least a scrolling sheet shows of its content in a short window. */
const LEAST_HEIGHT = size.listRowMin * 3;

/**
 * The style of the scroll area inside a sheet of this page. On a phone the sheet gives it the room
 * it has. In the dialog form the frame grows with its content, so the area stops at the window's
 * height less the frame's own padding, its title and the room kept clear round it.
 */
export function useSheetScroll(): ViewStyle {
  const layout = useBreakpoint();
  if (layout.breakpoint === 'compact') {
    return SHRINKS;
  }
  const chrome = layout.gutter * 2 + space.x6 * 2 + space.x4 + space.x12;
  return { ...SHRINKS, maxHeight: Math.max(LEAST_HEIGHT, layout.height - chrome) };
}
