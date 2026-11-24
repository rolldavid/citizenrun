import { useEffect } from 'react';
import type { RefObject } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { HostInstance, ViewStyle } from 'react-native';

import { isFirstScreen } from './first-screen';
import type { Theme } from './theme';
import { rule } from './tokens';

/** The focus ring (DS-focus): an outline in focusRing, outside the control, following its radius. */
export function focusRingStyle(theme: Theme, radius: number): ViewStyle {
  return {
    outlineStyle: 'solid',
    outlineWidth: rule.focus,
    outlineColor: theme.color.focusRing,
    outlineOffset: rule.focusGap,
    borderRadius: radius,
  };
}

/**
 * Moves focus to `ref`'s view once, after mount: a screen's level 1 heading after a route change, so a
 * screen reader announces the screen. The first screen of a page load is no route change: it leaves
 * the focus where the document starts it, so the first Tab reaches the skip link.
 */
export function useFocusOnMount(ref: RefObject<HostInstance | null>): void {
  useEffect(() => {
    const target = ref.current;
    if (target === null) return;
    if (isFirstScreen(target)) return;
    // Neither member is on every platform's implementation, whatever the types say.
    const focusable: { focus?: () => void } = target;
    if (typeof focusable.focus === 'function') focusable.focus();
    const info: Partial<Pick<typeof AccessibilityInfo, 'sendAccessibilityEvent'>> =
      AccessibilityInfo;
    if (typeof info.sendAccessibilityEvent === 'function') {
      info.sendAccessibilityEvent(target, 'focus');
    }
  }, [ref]);
}
