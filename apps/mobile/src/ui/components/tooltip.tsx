import { useEffect, useRef, useState } from 'react';
import type { JSX, ReactElement } from 'react';
import { View } from 'react-native';
import type { HostInstance, ViewStyle } from 'react-native';

import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useEscapeListener } from '@/ui/shortcuts';
import { useTheme } from '@/ui/theme';
import { gesture, radius, size, space, z } from '@/ui/tokens';

import { useOverlay } from './overlay-registry';
import { Text } from './text';

export type TooltipProps = { text: string; children: ReactElement };

/** The edge of the control the bubble lines up with. */
type Side = 'start' | 'end';

// While its bubble shows, the control stands above its neighbours, so the bubble is not drawn under them.
const RAISED: ViewStyle = { zIndex: z.popover };
// As large as the control, whatever its parent stretches: the pointer, the measure and the bubble's
// place all go by this view.
const HOLDER: ViewStyle = { alignSelf: 'flex-start' };
// A clear box as wide as the widest bubble, hung under the control: the bubble takes the width of
// its text inside it, where the control alone would hold it to the control's own width.
const ANCHOR: ViewStyle = {
  position: 'absolute',
  top: '100%',
  marginTop: space.x2,
  width: size.tooltipMax,
  zIndex: z.popover,
};
const ANCHOR_START: ViewStyle = { ...ANCHOR, left: 0, alignItems: 'flex-start' };
const ANCHOR_END: ViewStyle = { ...ANCHOR, right: 0, alignItems: 'flex-end' };
const BUBBLE: ViewStyle = {
  maxWidth: '100%',
  borderRadius: radius.control,
  paddingVertical: space.x1,
  paddingHorizontal: space.x2,
};
// Drawn clear until the control has been measured, so the bubble never shows on the wrong side.
const UNPLACED: ViewStyle = { opacity: 0 };

/** An element that can say whether a selector matches it: the web's can, a phone's view cannot. */
type Matcher = { matches: (selector: string) => boolean };

function isMatcher(element: unknown): element is Matcher {
  return (
    typeof element === 'object' &&
    element !== null &&
    'matches' in element &&
    typeof element.matches === 'function'
  );
}

/**
 * True when the focus is one a keyboard brought. The browser marks that focus and no other: a
 * press brings focus without the mark, and so does an overlay that hands focus back to its control
 * as it closes after a press or a touch. Where the element cannot say, focus is the keyboard's: a
 * phone moves focus for nothing else.
 */
function isKeyboardFocus(focused: unknown): boolean {
  if (!isMatcher(focused)) {
    return true;
  }
  try {
    return focused.matches(':focus-visible');
  } catch {
    // A browser that does not know the selector: every focus counts, as before the mark existed.
    return true;
  }
}

/**
 * C-Tooltip: names an icon-only control for a pointer or a keyboard. It shows at once on keyboard
 * focus and after a pause under a pointer, never from a touch, and leaves on blur, pointer-out, a
 * press or `Esc`. The control's own label carries the same text, so the bubble is hidden from
 * screen readers.
 */
export function Tooltip({ text, children }: TooltipProps): JSX.Element {
  const theme = useTheme();
  const { width: windowWidth } = useBreakpoint();
  const holder = useRef<HostInstance>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True from a press on the control until the focus that press brings, which shows nothing.
  const pressed = useRef(false);
  const [shown, setShown] = useState(false);
  // Kept between showings: a control seldom moves, and the first showing waits for its measure.
  const [side, setSide] = useState<Side | null>(null);

  const stopWaiting = (): void => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };

  const show = (): void => {
    stopWaiting();
    holder.current?.measureInWindow((x, _y, width) => {
      setSide(x + width / 2 > windowWidth / 2 ? 'end' : 'start');
    });
    setShown(true);
  };

  const hide = (): void => {
    stopWaiting();
    setShown(false);
  };

  useEffect(
    () => () => {
      if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
    },
    [],
  );
  useEscapeListener(hide, shown);
  useOverlay('tooltip', shown, hide);

  return (
    <View style={shown ? RAISED : null}>
      <View
        ref={holder}
        style={HOLDER}
        onPointerEnter={(event) => {
          if (event.nativeEvent.pointerType === 'touch') return;
          stopWaiting();
          hoverTimer.current = setTimeout(show, gesture.tooltipHoverDelayMs);
        }}
        onPointerLeave={hide}
        onPointerDown={() => {
          pressed.current = true;
          hide();
        }}
        onFocus={(event) => {
          if (pressed.current) {
            pressed.current = false;
            return;
          }
          if (isKeyboardFocus(event.target)) {
            show();
          }
        }}
        onBlur={() => {
          pressed.current = false;
          hide();
        }}
      >
        {children}
        {shown ? (
          <View
            style={side === 'end' ? ANCHOR_END : ANCHOR_START}
            pointerEvents="none"
            aria-hidden={true}
            accessibilityElementsHidden={true}
            importantForAccessibility="no-hide-descendants"
          >
            <View
              style={[
                BUBBLE,
                { backgroundColor: theme.color.inverseBg },
                side === null ? UNPLACED : null,
              ]}
            >
              <Text role="caption" tone="inverse">
                {text}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}
