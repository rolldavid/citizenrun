import type { JSX } from 'react';

import { ShellLayout } from './app-shell';
import type { AppShellProps } from './app-shell';

/**
 * C-CompactShell: the shell under the medium breakpoint, with no rail. It ignores the window, so
 * the gallery and the captures can draw this layout alone. No screen renders it, and C-AppShell
 * never swaps to it.
 */
export function CompactShell(props: AppShellProps): JSX.Element {
  return <ShellLayout {...props} breakpoint="compact" />;
}
