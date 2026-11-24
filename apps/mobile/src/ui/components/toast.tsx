import { assertNever } from '@citizenrun/shared';
import { useEffect, useSyncExternalStore } from 'react';
import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { playHaptic } from '@/ui/haptic';
import type { IconName } from '@/ui/icons';
import { motion, useFade } from '@/ui/motion';
import { useBottomChromeHeight } from '@/ui/shells/bottom-chrome';
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
 * Where the toast stands: centered above the bottom chrome on a phone, and centered in the content
 * slot, right of the rail, at medium and expanded (PC6A-27).
 */
function placeOf(layout: Layout, bottomChrome: number, bottomInset: number): ViewStyle {
  switch (layout.breakpoint) {
    case 'compact':
      return {
        left: 0,
        right: 0,
        bottom: (bottomChrome > 0 ? bottomChrome : bottomInset) + space.x4,
        paddingHorizontal: layout.gutter,
      };
    case 'medium':
      return { left: size.railIcon, right: 0, bottom: space.x6, paddingHorizontal: layout.gutter };
    case 'expanded': {
      const margin = (layout.width - Math.min(layout.width, size.contentMax)) / 2;
      return {
        left: margin + size.rail,
        right: margin,
        bottom: space.x6,
        paddingHorizontal: layout.gutter,
      };
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

function ToastLayer(): JSX.Element {
  const toast = useSyncExternalStore(subscribe, getCurrent, getCurrent);
  const layout = useBreakpoint();
  const bottomChrome = useBottomChromeHeight();
  const insets = useSafeAreaInsets();
  return (
    <View style={[LAYER, placeOf(layout, bottomChrome, insets.bottom)]} pointerEvents="box-none">
      {toast === null ? null : <ToastView key={toast.id} toast={toast} />}
    </View>
  );
}

/**
 * The home of C-Toast: the root layout renders it once, around the app. It draws its children and,
 * above them, the one toast `showToast` asked for: ink, with one icon that carries the kind, never
 * a color and never a button.
 */
export function ToastHost(props: { children: ReactNode }): JSX.Element {
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
      <ToastLayer />
    </>
  );
}
