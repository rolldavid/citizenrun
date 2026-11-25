// Motion presets as hooks (DS-motion). Lint rule citizenrun/tokens-only is off here.
// Timed state changes are CSS transitions on a Reanimated view; springs, sequences and loops are
// worklets. Both run the same way on every platform, and only transform and opacity move.
import { motion, REDUCED_MOTION_SPEC } from '@citizenrun/shared';
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ComponentProps, JSX, ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import type { ViewStyle } from 'react-native';
import {
  cancelAnimation,
  cubicBezier,
  Easing,
  makeMutable,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion as useReducedMotionAtStart,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type Animated from 'react-native-reanimated';
import { isWorkletFunction } from 'react-native-worklets';

import { opacity } from './tokens';

export { motion, MOTION_SPECS, resolveMotion } from '@citizenrun/shared';
export type { MotionId, MotionSpec, SpringName } from '@citizenrun/shared';

/** What a Reanimated view takes as its style: the value every hook here returns. */
export type AnimatedStyle = ComponentProps<typeof Animated.View>['style'];

// The hooks below have already chosen the reduced form, so no animation here asks the library to
// shorten itself: it would end the reduced fade at once.
const NEVER = ReduceMotion.Never;

/** easeOut as a CSS transition timing function. */
const EASE_OUT_CSS = cubicBezier(...motion.easeOut);
/** easeOut for a worklet's timed run. */
const EASE_OUT = Easing.bezier(...motion.easeOut);

/** The length of the one fade every preset becomes under reduced motion. */
const REDUCED_FADE_MS = REDUCED_MOTION_SPEC.durationMs ?? motion.duration.fade;
const REDUCED_FADE = { duration: REDUCED_FADE_MS, easing: EASE_OUT, reduceMotion: NEVER };

const STAMP_SPRING = { ...motion.spring.stamp, reduceMotion: NEVER };
const STANDARD_SPRING = { ...motion.spring.standard, reduceMotion: NEVER };

const PULSE_HALF = { duration: motion.duration.pulse / 2, easing: EASE_OUT, reduceMotion: NEVER };

/** A cut: the value is at its target on the next frame. */
const CUT = { duration: 0, reduceMotion: NEVER };

/**
 * useAnimatedStyle, given its dependency array only where the library reads it (06a section 6.2 rule 9,
 * D-838). Every app build runs the worklets Babel plugin, which gives the worklet its own list of what it
 * reads, and native Reanimated warns about an array it then ignores. The component tests run without the
 * plugin, where the array is the only way the library learns the dependencies. The updater carries the
 * `'worklet'` directive, because the plugin turns only the functions given straight to Reanimated's own
 * hooks into worklets without it.
 */
function useWorkletStyle(updater: () => ViewStyle, dependencies: unknown[]): AnimatedStyle {
  return useAnimatedStyle(updater, isWorkletFunction(updater) ? undefined : dependencies);
}

// The system's reduced-motion setting while the app runs. Reanimated's hook gives the value at start
// only; React Native's AccessibilityInfo (prefers-reduced-motion on the web) reports each change. One
// subscription serves the whole app while any component listens.
let systemReduced: boolean | null = null;
let systemSubscription: { remove: () => void } | null = null;
let changeSeen = false;
const systemListeners = new Set<() => void>();

function setSystemReduced(next: boolean): void {
  if (systemReduced === next) return;
  systemReduced = next;
  for (const listener of systemListeners) {
    listener();
  }
}

function subscribeSystemReduced(listener: () => void): () => void {
  systemListeners.add(listener);
  if (systemSubscription === null) {
    changeSeen = false;
    systemSubscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (next) => {
      changeSeen = true;
      setSystemReduced(next);
    });
    // The setting may have changed while nothing listened; a change reported meanwhile is newer.
    AccessibilityInfo.isReduceMotionEnabled().then(
      (next) => {
        if (!changeSeen) setSystemReduced(next);
      },
      () => undefined,
    );
  }
  return () => {
    systemListeners.delete(listener);
    if (systemListeners.size === 0 && systemSubscription !== null) {
      systemSubscription.remove();
      systemSubscription = null;
    }
  };
}

function systemReducedSnapshot(): boolean | null {
  return systemReduced;
}

function noSnapshotOnServer(): null {
  return null;
}

const ReducedMotionContext = createContext<boolean | null>(null);

/** Forces reduced motion on (true) or off (false) for the tree under it; null follows the system. */
export function ReducedMotionOverride(props: {
  value: boolean | null;
  children: ReactNode;
}): JSX.Element {
  return createElement(ReducedMotionContext.Provider, { value: props.value }, props.children);
}

/**
 * The nearest ReducedMotionOverride's value when it is not null, else the system's reduced-motion setting,
 * followed while the app runs.
 */
export function useReducedMotion(): boolean {
  const override = useContext(ReducedMotionContext);
  const atStart = useReducedMotionAtStart();
  const live = useSyncExternalStore(
    subscribeSystemReduced,
    systemReducedSnapshot,
    noSnapshotOnServer,
  );
  return override ?? live ?? atStart;
}

/**
 * MO-press. Spread `handlers` on the press target and `style` on a Reanimated view holding the content.
 * `forcedPressed` shows the pressed state without a press. Under reduced motion nothing moves and
 * `swapsFill` tells the control to show its pressed fill instead (PC6A-21).
 */
export function usePressMotion(forcedPressed?: boolean): {
  style: AnimatedStyle;
  handlers: { onPressIn: () => void; onPressOut: () => void };
  /** True between onPressIn and onPressOut, or while forcedPressed is true. */
  isPressed: boolean;
  /** isPressed under reduced motion: the control shows its pressed fill swap instead of moving. */
  swapsFill: boolean;
} {
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const isPressed = pressed || forcedPressed === true;
  const moves = isPressed && !reduced;
  return {
    style: {
      transitionProperty: 'transform',
      transitionDuration: motion.duration.press,
      transitionTimingFunction: EASE_OUT_CSS,
      transform: [
        { translateY: moves ? motion.distance.press : 0 },
        { scale: moves ? motion.scale.press : 1 },
      ],
    },
    handlers: {
      onPressIn: () => {
        setPressed(true);
      },
      onPressOut: () => {
        setPressed(false);
      },
    },
    isPressed,
    swapsFill: isPressed && reduced,
  };
}

/**
 * Lands on `stamp` from a starting scale (and angle, counter-clockwise, PC6A-39) each time `playKey`
 * changes to a non-null value: MO-like, MO-follow, MO-run. Nothing plays on mount. Under reduced
 * motion the view fades in once at its final transform instead.
 */
export function useStamp(
  playKey: string | number | null,
  from: { scale: number; rotateDeg?: number },
): AnimatedStyle {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);
  const fade = useSharedValue(1);
  const seenKey = useRef(playKey);
  const fromScale = from.scale;
  const fromRotate = from.rotateDeg ?? 0;

  useEffect(() => {
    if (seenKey.current === playKey) return;
    seenKey.current = playKey;
    if (playKey === null) return;
    if (reduced) {
      fade.set(0);
      fade.set(withTiming(1, REDUCED_FADE));
      return;
    }
    scale.set(fromScale);
    scale.set(withSpring(1, STAMP_SPRING));
    rotate.set(fromRotate);
    rotate.set(withSpring(0, STAMP_SPRING));
  }, [playKey, reduced, fromScale, fromRotate, scale, rotate, fade]);

  return useWorkletStyle(() => {
    'worklet';
    return reduced
      ? { opacity: fade.value }
      : { transform: [{ scale: scale.value }, { rotate: `${String(-rotate.value)}deg` }] };
  }, [reduced, fade, scale, rotate]);
}

/**
 * An animated style whose scale runs from `fromScale` to 1 on motion.spring.standard each time `playKey`
 * changes to a non-null value. Nothing plays on mount. Scale 1 with no animation under reduced motion
 * and while `playKey` is null.
 */
export function useSpringScale(playKey: string | number | null, fromScale: number): AnimatedStyle {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const seenKey = useRef(playKey);

  useEffect(() => {
    if (seenKey.current === playKey) return;
    seenKey.current = playKey;
    if (playKey === null || reduced) return;
    scale.set(fromScale);
    scale.set(withSpring(1, STANDARD_SPRING));
  }, [playKey, reduced, fromScale, scale]);

  return useWorkletStyle(() => {
    'worklet';
    return { transform: [{ scale: scale.value }] };
  }, [scale]);
}

/**
 * Rises `distance` and fades in over `durationMs` on easeOut when `play` turns true: numbers, bubbles.
 * Under reduced motion it is the one short fade, with no rise.
 */
export function useRise(play: boolean, distance: number, durationMs: number): AnimatedStyle {
  const reduced = useReducedMotion();
  if (reduced) {
    return {
      transitionProperty: 'opacity',
      transitionDuration: REDUCED_FADE_MS,
      transitionTimingFunction: EASE_OUT_CSS,
      opacity: play ? 1 : 0,
    };
  }
  return {
    transitionProperty: ['opacity', 'transform'],
    transitionDuration: durationMs,
    transitionTimingFunction: EASE_OUT_CSS,
    opacity: play ? 1 : 0,
    transform: [{ translateY: play ? 0 : distance }],
  };
}

/** Opacity 0 to 1 over `durationMs` (default motion.duration.fade) on easeOut when `visible` changes. */
export function useFade(visible: boolean, durationMs?: number): AnimatedStyle {
  return {
    transitionProperty: 'opacity',
    transitionDuration: durationMs ?? motion.duration.fade,
    transitionTimingFunction: EASE_OUT_CSS,
    opacity: visible ? 1 : 0,
  };
}

/**
 * Cuts each of `count` children on, one every `stepMs`, when `play` turns true: pips, ticks. Every
 * child is off until then. Under reduced motion they all fade in together, once.
 *
 * `count` must not change for the life of the component: the values behind the children are made
 * once, for the first count.
 */
export function useStagger(
  count: number,
  stepMs: number,
  play: boolean,
): (index: number) => AnimatedStyle {
  const reduced = useReducedMotion();
  // One opacity per child, held in state: a hook per child would be a hook in a loop.
  const [shown] = useState(() => Array.from({ length: count }, () => makeMutable(0)));

  useEffect(
    () => () => {
      for (const value of shown) {
        cancelAnimation(value);
      }
    },
    [shown],
  );

  useEffect(() => {
    if (!play) return;
    shown.forEach((value, index) => {
      value.set(
        reduced
          ? withTiming(1, REDUCED_FADE)
          : withDelay(index * stepMs, withTiming(1, CUT), NEVER),
      );
    });
  }, [play, reduced, stepMs, shown]);

  return (index) => ({ opacity: shown[index] });
}

// One clock for the whole app: every skeleton pulses in step, and the loop runs only while one shows.
const pulseClock = makeMutable(1);
let pulseCallers = 0;

function joinPulse(): () => void {
  pulseCallers += 1;
  if (pulseCallers === 1) {
    pulseClock.set(
      withRepeat(
        withSequence(NEVER, withTiming(opacity.skeletonLow, PULSE_HALF), withTiming(1, PULSE_HALF)),
        -1,
        false,
        undefined,
        NEVER,
      ),
    );
  }
  return () => {
    pulseCallers -= 1;
    if (pulseCallers === 0) {
      cancelAnimation(pulseClock);
      pulseClock.set(1);
    }
  };
}

/**
 * The loading pulse between 1 and opacity.skeletonLow on motion.duration.pulse (MO-loading). At
 * opacity 1 while `active` is false. Under reduced motion nothing pulses: a skeleton is still at
 * opacity 1 ('still', the default), and a control that is waiting ('held') is drawn at
 * opacity.skeletonLow for as long as it waits, the pulse's low point held, so the wait shows
 * without moving.
 */
export function usePulse(active: boolean, whenReduced: 'still' | 'held' = 'still'): AnimatedStyle {
  const reduced = useReducedMotion();
  const pulses = active && !reduced;
  const resting = active && reduced && whenReduced === 'held' ? opacity.skeletonLow : 1;

  useEffect(() => {
    if (!pulses) return undefined;
    return joinPulse();
  }, [pulses]);

  return useWorkletStyle(() => {
    'worklet';
    return { opacity: pulses ? pulseClock.value : resting };
  }, [pulseClock, pulses, resting]);
}

type OnceKind = 'meters' | 'ring' | 'number' | 'done' | 'enter';

// Kept outside any list cell, so an item scrolled away and back does not replay (D-178).
const played = new Map<OnceKind, Set<string>>();

/** True the first time `key` is seen for `kind`; `markPlayed` records it. Never true without a key. */
export function useOncePerItem(
  kind: OnceKind,
  key: string | undefined,
): { shouldPlay: boolean; markPlayed: () => void } {
  const shouldPlay = key !== undefined && played.get(kind)?.has(key) !== true;
  const markPlayed = (): void => {
    if (key === undefined) return;
    const keys = played.get(kind) ?? new Set<string>();
    keys.add(key);
    played.set(kind, keys);
  };
  return { shouldPlay, markPlayed };
}

/** Forgets every item seen: the session ended. */
export function clearOncePerItem(): void {
  for (const keys of played.values()) {
    keys.clear();
  }
}
