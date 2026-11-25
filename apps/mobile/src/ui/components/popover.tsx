import { useEffect, useRef, useState } from 'react';
import type { JSX, ReactNode, RefObject } from 'react';
import { Modal, Pressable as NativePressable, ScrollView, View } from 'react-native';
import type { HostInstance, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useFade } from '@/ui/motion';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space, z } from '@/ui/tokens';

import { usePresence } from './dialog';
import { placePopover } from './popover-placement';
import type { PopoverPlacement, Rect } from './popover-placement';

export type PopoverProps = {
  open: boolean;
  onClose: () => void;
  /** The control the popover stands by. */
  anchor: RefObject<HostInstance | null>;
  /** Default 'below-start'. It turns to the other side when it would leave the window. */
  placement?: PopoverPlacement;
  /** Default the anchor's width; never under `size.popoverMin`. */
  width?: number;
  /** Default true; false for a list of rows. */
  padded?: boolean;
  /** The accessible name. */
  label: string;
  testID: string;
  children: ReactNode;
};

/** One open popover. A fresh object per opening, so two popovers that share a close function stay apart. */
type OpenPopover = { close: () => void };

// The popover open now. One is open at a time.
const registry: { open: OpenPopover | null } = { open: null };

/** Registers an open popover and closes the one that was open before it. Returns the unregister function. */
function openPopover(close: () => void): () => void {
  const before = registry.open;
  const entry: OpenPopover = { close };
  registry.open = entry;
  before?.close();
  return () => {
    // A popover that was closed by a later one has already lost its place.
    if (registry.open === entry) {
      registry.open = null;
    }
  };
}

/** Registers while `open` is true. */
function useOnePopover(open: boolean, close: () => void): void {
  // The caller's latest close, so a new function each render does not register again.
  const latest = useRef(close);

  useEffect(() => {
    latest.current = close;
  }, [close]);

  useEffect(() => {
    if (!open) return undefined;
    return openPopover(() => {
      latest.current();
    });
  }, [open]);
}

/** Reads where the anchor stands in the window and hands it on; nothing for an anchor not drawn. */
function measureAnchor(
  anchor: RefObject<HostInstance | null>,
  onMeasured: (rect: Rect) => void,
): void {
  anchor.current?.measureInWindow((x, y, width, height) => {
    onMeasured({ x, y, width, height });
  });
}

const ROOT: ViewStyle = { flex: 1 };
// The whole window behind the surface, with no fill: a press on it closes the popover.
const BACKDROP: ViewStyle = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  cursor: 'auto',
};
const SURFACE: ViewStyle = {
  position: 'absolute',
  zIndex: z.popover,
  borderWidth: rule.hairline,
  borderRadius: radius.none,
};
const PADDED: ViewStyle = { padding: space.x6 };
// Takes no room and draws no ring: it only gives focus somewhere to stand.
const FOCUS_REST: ViewStyle = { outlineStyle: 'solid', outlineWidth: 0 };

/**
 * C-Popover: a small surface beside the control that opened it. `surface` with a hairline of
 * `rule` all round, no arrow, no scrim and no shadow. It stands `space.x2` from its anchor on the
 * side asked for, turns to the other side where it would leave the window, and scrolls what the
 * window cannot hold. It fades in and out and nothing else of it moves. One popover is open at a
 * time; `Esc` and a press outside close it.
 */
export function Popover({
  open,
  onClose,
  anchor,
  placement = 'below-start',
  width,
  padded = true,
  label,
  testID,
  children,
}: PopoverProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const insets = useSafeAreaInsets();
  const { mounted, shown } = usePresence(open);
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  useOnePopover(open, onClose);

  // Each opening measures its anchor again: the page may have moved it since the last one.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setAnchorRect(null);
    }
  }

  // On opening, and again whenever the window changes size while it is open.
  useEffect(() => {
    if (open) {
      measureAnchor(anchor, setAnchorRect);
    }
  }, [open, anchor, layout.width, layout.height]);

  // The window the popover may stand in: what the safe-area insets leave of it.
  const safe = {
    width: layout.width - insets.left - insets.right,
    height: layout.height - insets.top - insets.bottom,
  };
  const margin = layout.gutter;
  const surfaceWidth = Math.min(
    Math.max(width ?? anchorRect?.width ?? 0, size.popoverMin),
    safe.width - margin * 2,
  );
  // The surface as tall as all it holds, inside its two hairlines.
  const natural = contentHeight === null ? null : contentHeight + rule.hairline * 2;
  const placed =
    anchorRect === null || natural === null
      ? null
      : placePopover({
          anchor: { ...anchorRect, x: anchorRect.x - insets.left, y: anchorRect.y - insets.top },
          content: { width: surfaceWidth, height: natural },
          window: safe,
          placement,
          gap: space.x2,
          margin,
        });
  // Laid out unseen until its place is known, so the fade has somewhere to start.
  const fade = useFade(shown && placed !== null);

  return (
    <Modal
      transparent={true}
      animationType="none"
      statusBarTranslucent={true}
      navigationBarTranslucent={true}
      visible={mounted}
      onRequestClose={onClose}
      // A phone may give the anchor's place before its layout settles: it is read again once the
      // popover's own window is up.
      onShow={() => {
        measureAnchor(anchor, setAnchorRect);
      }}
    >
      <View style={ROOT}>
        {/* The surface comes first, so focus starts inside it. */}
        <Animated.View
          role="dialog"
          aria-modal={true}
          aria-label={label}
          accessibilityViewIsModal={true}
          onAccessibilityEscape={onClose}
          testID={testID}
          style={[
            SURFACE,
            {
              backgroundColor: theme.color.surface,
              borderColor: theme.color.rule,
              width: surfaceWidth,
              top: (placed?.top ?? 0) + insets.top,
              left: (placed?.left ?? 0) + insets.left,
            },
            placed === null ? null : { maxHeight: placed.maxHeight },
            fade,
          ]}
        >
          <ScrollView
            scrollEnabled={placed !== null && natural !== null && natural > placed.maxHeight}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={padded ? PADDED : null}
            onContentSizeChange={(_width, height) => {
              setContentHeight(height);
            }}
          >
            {children}
          </ScrollView>
          {/* Focus starts on the first thing inside that takes it. A popover that holds no such
              thing gives it this place, so focus is inside the popover and never on the window
              behind it. */}
          <View
            tabIndex={-1}
            accessible={false}
            importantForAccessibility="no"
            style={FOCUS_REST}
          />
        </Animated.View>
        <NativePressable
          accessible={false}
          focusable={false}
          tabIndex={-1}
          testID={`${testID}-backdrop`}
          style={BACKDROP}
          onPress={onClose}
        />
      </View>
    </Modal>
  );
}
