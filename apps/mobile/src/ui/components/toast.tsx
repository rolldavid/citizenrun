import { assertNever } from '@citizenrun/shared';
import { useEffect, useId, useSyncExternalStore } from 'react';
import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { playHaptic } from '@/ui/haptic';
import type { IconName } from '@/ui/icons';
import { motion, useFade } from '@/ui/motion';
import { useBottomChromeHeight } from '@/ui/shells/bottom-chrome';
import { useSideChromeWidth } from '@/ui/shells/side-chrome';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import type { Layout } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { radius, size, space, z } from '@/ui/tokens';

import { Icon } from './icon';
import { Text } from './text';

type ToastKind = 'success' | 'warning' | 'error';

type ToastInput = { kind: ToastKind; text: string; testID?: string };

type ShownToast = ToastInput & {
  /** A new number for each toast, so one that replaces another is drawn afresh. */
  id: number;
  /** True once the hold has run and the toast is fading out. */
  leaving: boolean;
};

// The one toast showing now (MO-toast), for every host. Null when none shows.
let current: ShownToast | null = null;
let lastId = 0;
let hosts = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const subscribers = new Set<() => void>();

function publish(next: ShownToast | null): void {
  current = next;
  for (const subscriber of [...subscribers]) subscriber();
}

function subscribe(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => {
    subscribers.delete(subscriber);
  };
}

function getCurrent(): ShownToast | null {
  return current;
}

// The open overlays that draw the toast themselves, the latest last. A dialog and a sheet are laid
// over the whole app, the host's layer with it, so the toast is drawn inside the one on top.
let outlets: readonly string[] = [];

function topOutlet(): string | null {
  return outlets.at(-1) ?? null;
}

function setOutlets(next: readonly string[]): void {
  outlets = next;
  for (const subscriber of [...subscribers]) subscriber();
}

function stopTimer(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

/**
 * Shows one toast: it cuts in, holds and fades out. A toast that is showing is replaced, and its
 * time starts again. An `error` or a `warning` plays the warning haptic. Without a mounted
 * `ToastHost` nothing happens.
 */
export function showToast(input: ToastInput): void {
  if (hosts === 0) return;
  stopTimer();
  lastId += 1;
  const shown: ShownToast = { ...input, id: lastId, leaving: false };
  if (input.kind !== 'success') {
    playHaptic('warning');
  }
  publish(shown);
  timer = setTimeout(() => {
    publish({ ...shown, leaving: true });
    timer = setTimeout(() => {
      timer = null;
      publish(null);
    }, motion.duration.fade);
  }, motion.duration.toastHold);
}

function iconOf(kind: ToastKind): IconName {
  switch (kind) {
    case 'success':
      return 'check';
    case 'warning':
      return 'warning';
    case 'error':
      return 'error';
    default:
      return assertNever(kind);
  }
}

const LAYER: ViewStyle = { position: 'absolute', alignItems: 'center', zIndex: z.toast };
const SHEET_ANCHOR: ViewStyle = { height: 0, zIndex: z.toast };
const TOAST: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x2,
  maxWidth: size.toastMax,
  borderRadius: radius.control,
  paddingVertical: space.x3,
  paddingHorizontal: space.x4,
};
const WORDS: ViewStyle = { flexShrink: 1 };

/**
 * Where the layer stands. `shell`: over the app, centered above the bottom chrome on a phone and in
 * the content slot at medium and expanded, right of the rail where one is drawn (PC6A-27).
 * `screen`: the same place, drawn by a screen that fills the window and brings a theme of its own.
 * `window`: inside an overlay that covers the window, centered in it. `sheet`: with a sheet on a
 * phone, over its top edge or, on a tall sheet, above its footer.
 */
type ToastPlace = 'shell' | 'screen' | 'window' | 'sheet';

type Chrome = {
  bottomChrome: number;
  bottomInset: number;
  leftInset: number;
  rightInset: number;
  rail: number;
  /** In a sheet: how far over the outlet the sheet's top edge is, 0 when the toast stands at the outlet. */
  lift: number;
};

function placeOf(place: ToastPlace, layout: Layout, chrome: Chrome): ViewStyle {
  const sides: ViewStyle = { left: 0, right: 0, paddingHorizontal: layout.gutter };
  if (place === 'sheet') {
    // The sheet's outlet is as wide as its content, which keeps clear of the gutter and the side
    // insets; the toast is centered on the sheet, which is as wide as the window.
    return {
      left: -(layout.gutter + chrome.leftInset),
      right: -(layout.gutter + chrome.rightInset),
      paddingHorizontal: layout.gutter,
      bottom: chrome.lift > 0 ? chrome.lift + space.x4 : 0,
    };
  }
  // A screen that fills the window stands where the app does.
  const overApp = place === 'shell' || place === 'screen';
  switch (layout.breakpoint) {
    case 'compact': {
      // An overlay covers the tab bar and the footer: the toast stands above the bottom inset.
      const covered = overApp && chrome.bottomChrome > 0;
      return { ...sides, bottom: (covered ? chrome.bottomChrome : chrome.bottomInset) + space.x4 };
    }
    case 'medium':
      return { ...sides, left: overApp ? chrome.rail : 0, bottom: space.x6 };
    case 'expanded': {
      if (!overApp) {
        return { ...sides, bottom: space.x6 };
      }
      // The capped row the shell centers in the window, and the rail at its left.
      const margin = (layout.width - Math.min(layout.width, size.contentMax)) / 2;
      return { ...sides, left: margin + chrome.rail, right: margin, bottom: space.x6 };
    }
    default:
      return assertNever(layout.breakpoint);
  }
}

function ToastView({ toast }: { toast: ShownToast }): JSX.Element {
  const theme = useTheme();
  const fade = useFade(!toast.leaving);
  // A failure or a warning interrupts; a confirmation waits its turn.
  const urgent = toast.kind !== 'success';
  return (
    <Animated.View
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      testID={toast.testID ?? 'toast'}
      style={[TOAST, { backgroundColor: theme.color.inverseBg }, fade]}
    >
      <Icon name={iconOf(toast.kind)} size="medium" tone="inverse" />
      <View style={WORDS}>
        <Text role="label" tone="inverse">
          {toast.text}
        </Text>
      </View>
    </Animated.View>
  );
}

function ToastLayer({ place, lift = 0 }: { place: ToastPlace; lift?: number }): JSX.Element {
  const toast = useSyncExternalStore(subscribe, getCurrent, getCurrent);
  const layout = useBreakpoint();
  const bottomChrome = useBottomChromeHeight();
  const rail = useSideChromeWidth();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        LAYER,
        placeOf(place, layout, {
          bottomChrome,
          bottomInset: insets.bottom,
          leftInset: insets.left,
          rightInset: insets.right,
          rail,
          lift,
        }),
      ]}
      pointerEvents="box-none"
    >
      {toast === null ? null : <ToastView key={toast.id} toast={toast} />}
    </View>
  );
}

/**
 * The toast's place outside the host. C-Dialog's frame and C-Sheet render it, so a toast shown
 * while they are open is drawn above them and inside what a screen reader can reach. The gallery
 * renders it with `place="screen"` inside its own theme provider, as its last child, so the toast
 * takes the theme, the text size and the motion the gallery is set to. Only the outlet on top draws
 * the toast, and the host draws none meanwhile.
 */
export function ToastOutlet({
  place,
  active = true,
  lift = 0,
}: {
  place: 'window' | 'sheet' | 'screen';
  /** False while the overlay is closed. Default true. */
  active?: boolean;
  /**
   * `sheet` only: how far over the outlet the sheet's top edge is, where the window has room for
   * a toast above the sheet; the toast then stands `space.x4` over that edge. Default 0: the toast
   * rises from the outlet.
   */
  lift?: number;
}): JSX.Element | null {
  const id = useId();
  const top = useSyncExternalStore(subscribe, topOutlet, topOutlet);

  useEffect(() => {
    if (!active) return undefined;
    setOutlets([...outlets, id]);
    return () => {
      setOutlets(outlets.filter((outlet) => outlet !== id));
    };
  }, [active, id]);

  if (top !== id) {
    return null;
  }
  // A sheet holds the outlet in its column, above its footer. The toast stands over the sheet
  // where there is room, and covers nothing of it; on a tall sheet it rises from the outlet's
  // line and covers no button.
  return place === 'sheet' ? (
    <View style={SHEET_ANCHOR} pointerEvents="box-none">
      <ToastLayer place={place} lift={lift} />
    </View>
  ) : (
    <ToastLayer place={place} />
  );
}

/**
 * The home of C-Toast: the root layout renders it once, around the app. It draws its children and,
 * above them, the one toast `showToast` asked for: ink, with one icon that carries the kind, never
 * a color and never a button. While a dialog or a sheet is open the toast is drawn inside it.
 */
export function ToastHost(props: { children: ReactNode }): JSX.Element {
  const covered = useSyncExternalStore(subscribe, topOutlet, topOutlet) !== null;
  useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
      if (hosts === 0) {
        stopTimer();
        publish(null);
      }
    };
  }, []);

  return (
    <>
      {props.children}
      {covered ? null : <ToastLayer place="shell" />}
    </>
  );
}
