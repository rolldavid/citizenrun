import { useTheme } from '@/ui/theme';
import { textScale } from '@/ui/tokens';

import { useBreakpoint } from './use-breakpoint';

/**
 * Whether the layout is tight: a narrow window at a large text size. A development screen's own
 * text size counts as the system's does, so a review of large text in a browser shows what a phone
 * draws. Every component and screen that changes on a tight layout asks here, so they change
 * together.
 */
export function useTight(): boolean {
  const layout = useBreakpoint();
  const theme = useTheme();
  return layout.isTight || (layout.isNarrow && theme.textScale >= textScale.tightFrom);
}
