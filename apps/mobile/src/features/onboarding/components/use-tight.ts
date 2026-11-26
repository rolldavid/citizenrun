import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { textScale } from '@/ui/tokens';

/**
 * Whether a sign-up step is laid out tight: a narrow window at a large text size. A development
 * screen's own text size counts as the system's does, the rule the issue grid goes to one column
 * by, so a step and its grid change together.
 */
export function useTight(): boolean {
  const layout = useBreakpoint();
  const theme = useTheme();
  return layout.isTight || (layout.isNarrow && theme.textScale >= textScale.tightFrom);
}
