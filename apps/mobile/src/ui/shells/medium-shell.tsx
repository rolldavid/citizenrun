import type { JSX } from 'react';

import { ShellLayout } from './app-shell';
import type { AppShellProps } from './app-shell';

/**
 * C-MediumShell: the shell between the medium and the expanded breakpoints, with the icons rail.
 * It ignores the window, so the gallery and the captures can draw this layout alone. No screen
 * renders it, and C-AppShell never swaps to it.
 */
export function MediumShell(props: AppShellProps): JSX.Element {
  return <ShellLayout {...props} breakpoint="medium" />;
}
