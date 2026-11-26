import type { JSX } from 'react';

import { TabBar } from '@/ui/shells/tab-bar';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';

import { useRootNav } from './root-layout-screen';

/**
 * The tab navigator's bar: C-TabBar with the root layout's values, on a phone only. From medium up
 * the rail is the navigation, and the two are never drawn together.
 */
export function RootTabBar(): JSX.Element | null {
  const nav = useRootNav();
  const { breakpoint } = useBreakpoint();
  if (breakpoint !== 'compact') {
    return null;
  }
  return (
    <TabBar
      active={nav.active ?? 'home'}
      onNavigate={nav.onNavigate}
      onReselect={nav.onReselect}
      unreadActivity={nav.unreadActivity}
    />
  );
}
