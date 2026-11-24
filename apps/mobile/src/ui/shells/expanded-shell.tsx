import type { JSX } from 'react';

import { ShellLayout } from './app-shell';
import type { AppShellProps } from './app-shell';

/**
 * C-ExpandedShell: the shell from the expanded breakpoint up, with the labeled rail in a row
 * capped at the content width. It ignores the window, so the gallery and the captures can draw
 * this layout alone. No screen renders it, and C-AppShell never swaps to it.
 */
export function ExpandedShell(props: AppShellProps): JSX.Element {
  return <ShellLayout {...props} breakpoint="expanded" />;
}
