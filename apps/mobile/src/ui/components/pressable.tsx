import { Link } from 'expo-router';
import type { Href } from 'expo-router';
import { createContext, useContext, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { Pressable as NativePressable, View } from 'react-native';
import type { Insets, KeyDownEvent, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { focusRingStyle } from '@/ui/focus';
import { playHaptic } from '@/ui/haptic';
import type { HapticName } from '@/ui/haptic';
import { usePressMotion } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import { gesture, radius, size } from '@/ui/tokens';

export type PressableProps = {
  onPress?: () => void;
  onLongPress?: () => void;
  /** An in-app path, or with `external` an outside https:// URL: renders a link, an anchor on the web. */
  href?: string;
  /** Default false. True: `href` opens outside the app, on the web in a new tab. */
  external?: boolean;
  disabled?: boolean;
  /** Default 'move' (MO-press). */
  feedback?: 'move' | 'fill' | 'moveAndFill' | 'none';
  /** Default 'none'; 'fill' paints hoverBg under a pointer. */
  hover?: 'fill' | 'none';
  /** The visible size, from which the hit slop up to the smallest target is worked out. */
  drawn?: { width: number; height: number };
  /** Played on press. */
  haptic?: HapticName;
  /** Default radius.control: the corner radius of the control's box; the focus ring and the fills follow it. */
  radius?: number;
  /** The active item of a navigation list (C-TabBar, C-Rail). */
  current?: boolean;
  role: 'button' | 'link' | 'checkbox' | 'radio' | 'switch' | 'tab' | 'menuitem' | 'option';
  /** The accessible name. */
  label: string;
  hint?: string;
  state?: { selected?: boolean; checked?: boolean; expanded?: boolean; busy?: boolean };
  testID: string;
  children:
    | ReactNode
    | ((s: {
        pressed: boolean;
        hovered: boolean;
        focused: boolean;
        /** Pressed under reduced motion: the control shows its pressed fill instead of moving (PC6A-21). */
        swapsFill: boolean;
      }) => ReactNode);
};

/** An interaction state forced from outside: a hover, a press or a focus no prop can express. */
export type InteractionPreviewState = { pressed?: boolean; hovered?: boolean; focused?: boolean };

const PreviewContext = createContext<InteractionPreviewState>({});

/** Shows every C-Pressable under it in a forced state. Only the gallery and tests render it. */
export function InteractionPreview(props: {
  state: InteractionPreviewState;
  children: ReactNode;
}): JSX.Element {
  return <PreviewContext.Provider value={props.state}>{props.children}</PreviewContext.Provider>;
}

/** The hit slop that brings a drawing smaller than the smallest target up to it, on each axis. */
export function hitSlopFor(
  drawn: { width: number; height: number } | undefined,
): Insets | undefined {
  if (drawn === undefined) {
    return undefined;
  }
  const vertical = Math.max(0, (size.target - drawn.height) / 2);
  const horizontal = Math.max(0, (size.target - drawn.width) / 2);
  return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
}

/**
 * The hit slop as a clear box inside the target, under the content, that reaches past the drawing
 * by the same insets. The web has no hit slop, and a phone ends one at the bounds of the control's
 * parent; a box that belongs to the target is pressed wherever it shows. Undefined when the drawing
 * meets the target.
 */
function reachFor(slop: Insets | undefined): ViewStyle | undefined {
  const { top = 0, bottom = 0, left = 0, right = 0 } = slop ?? {};
  if (top <= 0 && bottom <= 0 && left <= 0 && right <= 0) {
    return undefined;
  }
  return { position: 'absolute', top: -top, bottom: -bottom, left: -left, right: -right };
}

/** True for a press target that can be clicked from code: the web's has the method, a phone's has not. */
function canClick(target: unknown): target is { click: () => void } {
  return (
    typeof target === 'object' &&
    target !== null &&
    'click' in target &&
    typeof target.click === 'function'
  );
}

const EXTERNAL_TARGET = '_blank';
const EXTERNAL_REL = 'noopener noreferrer nofollow';
/**
 * The anchor attributes of an outside link, as the web's press target reads them. The router hands
 * `target` and `rel` to its child as plain props, which that target does not read.
 */
const EXTERNAL_ANCHOR = { hrefAttrs: { target: EXTERNAL_TARGET, rel: EXTERNAL_REL } };

/**
 * What marks the active item of a navigation list: the web reads `aria-current`, and a phone, which
 * has no such attribute, reads the selected state. Never `aria-selected`, which a link may not carry.
 */
const CURRENT_ITEM = { 'aria-current': 'page', accessibilityState: { selected: true } } as const;

/**
 * C-Pressable: the one press target. Pressed runs MO-press on its content, paints pressedBg, or
 * both; a pointer paints hoverBg where asked; focus draws the ring. A C-Pressable never holds another.
 */
export function Pressable({
  onPress,
  onLongPress,
  href,
  external = false,
  disabled = false,
  feedback = 'move',
  hover = 'none',
  drawn,
  haptic,
  radius: corner = radius.control,
  current = false,
  role,
  label,
  hint,
  state,
  testID,
  children,
}: PressableProps): JSX.Element {
  const theme = useTheme();
  const preview = useContext(PreviewContext);
  const motion = usePressMotion(preview.pressed === true);
  const [isHovered, setHovered] = useState(false);
  const [isFocused, setFocused] = useState(false);

  const pressed = motion.isPressed;
  const hovered = isHovered || preview.hovered === true;
  const focused = isFocused || preview.focused === true;
  const fills = feedback === 'fill' || feedback === 'moveAndFill';
  const moves = feedback === 'move' || feedback === 'moveAndFill';

  const press = (): void => {
    if (haptic !== undefined) {
      playHaptic(haptic);
    }
    onPress?.();
  };

  // A button, and a link with an address, are pressed from the keyboard by the platform itself. For
  // every other role the web presses on Enter alone, so Space clicks the target where it can be
  // clicked from code. A link with no address is no anchor, and the web leaves its Enter to the
  // browser, which follows nothing: Enter clicks it, and Space, as on any link, does not.
  const onKeyDown = (event: KeyDownEvent): void => {
    const { key, repeat } = event.nativeEvent;
    if (disabled || role === 'button' || repeat === true) {
      return;
    }
    const pressesOn = role === 'link' ? (href === undefined ? 'Enter' : null) : ' ';
    if (key !== pressesOn) {
      return;
    }
    const target: unknown = event.currentTarget;
    if (canClick(target)) {
      event.preventDefault();
      target.click();
    }
  };

  const fill =
    pressed && fills
      ? theme.color.pressedBg
      : hovered && hover === 'fill'
        ? theme.color.hoverBg
        : null;
  // Content that moves carries the fill with it, so the fill stays inside the control's outline.
  const painted: ViewStyle | undefined =
    fill === null ? undefined : { backgroundColor: fill, borderRadius: corner };
  // One plain object: the router's link refuses a child whose style is a list.
  const style: ViewStyle = {
    borderRadius: corner,
    ...(disabled ? {} : { cursor: 'pointer' }),
    ...(moves ? {} : painted),
    ...(focused ? focusRingStyle(theme, corner) : {}),
  };

  const content =
    typeof children === 'function'
      ? children({ pressed, hovered, focused, swapsFill: motion.swapsFill })
      : children;
  const slop = hitSlopFor(drawn);
  const reach = reachFor(slop);
  // A phone lets `aria-selected` win over the selected state, so the current item never sends it.
  const selected = current ? undefined : state?.selected;

  const target = (
    <NativePressable
      {...(external ? EXTERNAL_ANCHOR : {})}
      {...(current ? CURRENT_ITEM : {})}
      role={role}
      aria-label={label === '' ? undefined : label}
      accessibilityHint={hint}
      aria-selected={selected}
      aria-checked={state?.checked}
      aria-expanded={state?.expanded}
      aria-busy={state?.busy}
      aria-disabled={disabled}
      disabled={disabled}
      testID={testID}
      hitSlop={slop}
      style={style}
      onPress={press}
      onLongPress={onLongPress}
      delayLongPress={gesture.longPressMs}
      onPressIn={motion.handlers.onPressIn}
      onPressOut={motion.handlers.onPressOut}
      onHoverIn={() => {
        setHovered(true);
      }}
      onHoverOut={() => {
        setHovered(false);
      }}
      onFocus={() => {
        setFocused(true);
      }}
      onBlur={() => {
        setFocused(false);
      }}
      onKeyDown={onKeyDown}
    >
      {reach === undefined ? null : <View style={reach} />}
      {moves ? <Animated.View style={[motion.style, painted]}>{content}</Animated.View> : content}
    </NativePressable>
  );

  // A disabled link is not wrapped, so nothing can follow it.
  if (href === undefined || disabled) {
    return target;
  }
  return (
    <Link
      href={href as Href} // the router's generated route types cannot name a path that arrives as a prop
      asChild
      {...(external ? { target: EXTERNAL_TARGET, rel: EXTERNAL_REL } : {})}
    >
      {target}
    </Link>
  );
}
