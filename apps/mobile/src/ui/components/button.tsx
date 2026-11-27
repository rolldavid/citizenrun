import { assertNever } from '@citizenrun/shared';
import { useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import type { LayoutChangeEvent, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import type { HapticName } from '@/ui/haptic';
import type { IconName } from '@/ui/icons';
import { usePulse } from '@/ui/motion';
import { useTight } from '@/ui/shells/use-tight';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';
import type { ThemeColors } from '@/ui/tokens';
import type { ResolvedTone } from '@/ui/tone';

import { Icon } from './icon';
import { MeasureRuns, wordsOf } from './measure-runs';
import { Pressable } from './pressable';
import type { PressableProps } from './pressable';
import { Text } from './text';

type ButtonBase = {
  /** The standard height (default) or the small one. */
  size?: 'md' | 'sm';
  label: string;
  /** Only on a button that opens another screen ("See the filing steps"). */
  trailingIcon?: 'chevronRight';
  /** Draws the check before the label; used with 'primary' for Running and Following. */
  done?: boolean;
  onPress?: () => void;
  href?: string;
  /** The label must then say why ("Filing closed"). */
  disabled?: boolean;
  busy?: boolean;
  fullWidth?: boolean;
  /** Used on a tight layout, where the label would wrap ("Run" for "Run for this office"). */
  shortLabel?: string;
  /** The accessible name when it differs from the label ("Run for this office", "Follow Dana Okafor"). */
  accessibilityLabel?: string;
  /** The hint ("Press to stop following"). */
  accessibilityHint?: string;
  /** Sets the selected state: Run while running, Follow while following. */
  selected?: boolean;
  haptic?: HapticName;
  testID: string;
};

export type ButtonVariant = 'run' | 'primary' | 'secondary' | 'quiet' | 'destructive';

export type ButtonProps = ButtonBase &
  (
    | { variant: 'run'; icon?: never }
    | {
        variant: Exclude<ButtonVariant, 'run'>;
        /** Before the label; never on 'run'. */
        icon?: IconName;
      }
  );

type Look = {
  /** The fill of the button's own box; null leaves it clear. */
  fill: string | null;
  /** The fill under a pointer and, under reduced motion, while pressed; null where C-Pressable paints both. */
  swap: string | null;
  outline: string | null;
  tone: ResolvedTone;
  feedback: NonNullable<PressableProps['feedback']>;
  hover: NonNullable<PressableProps['hover']>;
};

function lookOf(variant: ButtonVariant, color: ThemeColors): Look {
  switch (variant) {
    case 'run':
      return {
        fill: color.accent,
        swap: color.accentHover,
        outline: null,
        tone: 'onAccent',
        feedback: 'move',
        hover: 'none',
      };
    case 'primary':
      return {
        fill: color.inverseBg,
        swap: color.inverseHover,
        outline: null,
        tone: 'inverse',
        feedback: 'move',
        hover: 'none',
      };
    case 'secondary':
      return {
        fill: null,
        swap: null,
        outline: color.rule,
        tone: 'primary',
        feedback: 'moveAndFill',
        hover: 'fill',
      };
    case 'quiet':
      return {
        fill: null,
        swap: null,
        outline: null,
        tone: 'primary',
        feedback: 'fill',
        hover: 'fill',
      };
    case 'destructive':
      return {
        fill: null,
        swap: null,
        outline: color.danger,
        tone: 'danger',
        feedback: 'fill',
        hover: 'fill',
      };
    default:
      return assertNever(variant);
  }
}

const ROW: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: space.x2,
};
const PULSING_ROW: ViewStyle = { ...ROW, flexShrink: 1 };

/**
 * The icon and label of a waiting button, on the loading pulse (PC6A-04). Under reduced motion
 * they are held at the pulse's low point, so a wait still looks unlike rest.
 */
function PulsingRow({ children }: { children: ReactNode }): JSX.Element {
  const pulse = usePulse(true, 'held');
  return <Animated.View style={[PULSING_ROW, pulse]}>{children}</Animated.View>;
}

/** How a label stands in a full-width button: whole, with less side room, or also without its icon. */
export type ButtonFit = 'whole' | 'snug' | 'bare';

/** What a full-width button measures of itself: its width, and its words set on one line. */
export type ButtonMeasure = {
  /** The button's width. */
  room: number;
  /** The long label on one line. */
  label: number;
  /** Each word of the label shown, on its own. */
  words: readonly number[];
};

/** The widths a button keeps beside its words, at a side room. */
function besideWords(side: number, icons: number): number {
  return 2 * side + 2 * rule.hairline + icons * (size.icon.medium + space.x2);
}

/**
 * Whether a full-width button shows its short label: on a tight layout, and wherever the long one
 * would not stand on one line in the button's width.
 */
export function showsShortLabel(
  measure: Pick<ButtonMeasure, 'room' | 'label'> | null,
  tight: boolean,
  side: number,
  icons: number,
): boolean {
  if (tight) return true;
  return measure !== null && measure.label + besideWords(side, icons) > measure.room;
}

/**
 * How a label fits a full-width button that is too narrow for one of its words: a label wraps only
 * between words and is never cut, so the button first takes the small side room, then leaves out
 * its leading icon (the check of a done state, which its fill already says).
 */
export function buttonFit(
  measure: Pick<ButtonMeasure, 'room' | 'words'> | null,
  side: number,
  icons: number,
  leading: boolean,
): ButtonFit {
  if (measure === null || measure.words.length === 0) return 'whole';
  const widest = Math.max(...measure.words);
  if (widest + besideWords(side, icons) <= measure.room) return 'whole';
  if (widest + besideWords(space.x2, icons) <= measure.room) return 'snug';
  return leading ? 'bare' : 'snug';
}

/**
 * C-Button: a labelled action. 'run' is the only accent fill, 'primary' is ink, and the other three
 * have no fill of their own. The label may wrap to two lines and grows the button. While busy the
 * label pulses, or is held dim under reduced motion, and presses are ignored; the button keeps its
 * fill and its width.
 */
export function Button({
  variant,
  size: sizeName = 'md',
  label,
  icon,
  trailingIcon,
  done = false,
  onPress,
  href,
  disabled = false,
  busy = false,
  fullWidth = false,
  shortLabel,
  accessibilityLabel,
  accessibilityHint,
  selected,
  haptic,
  testID,
}: ButtonProps): JSX.Element {
  const theme = useTheme();
  const tight = useTight();
  const look = lookOf(variant, theme.color);
  const small = sizeName === 'sm';
  const tone: ResolvedTone = disabled ? 'disabled' : look.tone;
  const side = variant === 'quiet' ? space.x2 : small ? space.x3 : space.x4;
  // A full-width button measures what it holds, so a label never breaks inside a word.
  const [room, setRoom] = useState<number | null>(null);
  const [labelWidth, setLabelWidth] = useState<number | null>(null);
  const [wordWidths, setWordWidths] = useState<Readonly<Partial<Record<string, number>>>>({});
  const iconsOf = (withLeading: boolean): number =>
    (withLeading ? 1 : 0) + (trailingIcon === undefined ? 0 : 1);
  const baseLeading: IconName | undefined = done ? 'check' : icon;
  const short =
    shortLabel !== undefined &&
    showsShortLabel(
      fullWidth && room !== null && labelWidth !== null ? { room, label: labelWidth } : null,
      tight,
      side,
      iconsOf(baseLeading !== undefined),
    );
  // The accessible name stays the long label, or the name the caller gives.
  const words = short ? shortLabel : label;
  const shownWords = wordsOf(words);
  const measuredWords = shownWords.flatMap((word) => {
    const width = wordWidths[word];
    return width === undefined ? [] : [width];
  });
  const fit: ButtonFit =
    fullWidth && room !== null && measuredWords.length === shownWords.length
      ? buttonFit(
          { room, words: measuredWords },
          side,
          iconsOf(baseLeading !== undefined),
          baseLeading !== undefined,
        )
      : 'whole';
  const leading: IconName | undefined = fit === 'bare' ? undefined : baseLeading;
  const allWords = [...new Set([...wordsOf(label), ...wordsOf(shortLabel ?? '')])];

  const parts = (
    <>
      {leading === undefined ? null : <Icon name={leading} size="medium" tone={tone} />}
      {/* Lets a long label wrap beside an icon. */}
      <View style={{ flexShrink: 1 }}>
        <Text role={small ? 'label' : 'bodyStrong'} tone={tone} numberOfLines={2} align="center">
          {words}
        </Text>
      </View>
      {trailingIcon === undefined ? null : <Icon name={trailingIcon} size="medium" tone={tone} />}
    </>
  );

  const fillFor = (hovered: boolean, swapsFill: boolean): string | null => {
    if (disabled) {
      return variant === 'quiet' ? null : theme.color.disabledBg;
    }
    return look.swap !== null && (hovered || swapsFill) ? look.swap : look.fill;
  };

  return (
    // Never wider than the room it stands in: in a row that wraps, a long label takes a second line.
    <View
      style={{ alignSelf: fullWidth ? 'stretch' : 'flex-start', maxWidth: '100%' }}
      {...(fullWidth
        ? {
            onLayout: (event: LayoutChangeEvent) => {
              setRoom(event.nativeEvent.layout.width);
            },
          }
        : {})}
    >
      {/* Measured once the button has a width of its own to measure against. */}
      {fullWidth && room !== null ? (
        <MeasureRuns
          role={small ? 'label' : 'bodyStrong'}
          runs={[label, ...allWords]}
          onRun={(index, width) => {
            if (index === 0) {
              setLabelWidth(width);
              return;
            }
            const word = allWords[index - 1];
            if (word === undefined) return;
            setWordWidths((known) => (known[word] === width ? known : { ...known, [word]: width }));
          }}
        />
      ) : null}
      <Pressable
        role={href === undefined ? 'button' : 'link'}
        label={accessibilityLabel ?? label}
        {...(accessibilityHint === undefined ? {} : { hint: accessibilityHint })}
        disabled={disabled}
        state={selected === undefined ? { busy } : { busy, selected }}
        testID={testID}
        radius={radius.control}
        feedback={look.feedback}
        hover={look.hover}
        {...(small ? { drawn: { width: size.target, height: size.buttonSmall } } : {})}
        {...(busy || onPress === undefined ? {} : { onPress })}
        {...(busy || href === undefined ? {} : { href })}
        {...(busy || haptic === undefined ? {} : { haptic })}
      >
        {({ hovered, swapsFill }) => {
          const fill = fillFor(hovered, swapsFill);
          return (
            <View
              style={[
                ROW,
                {
                  minHeight: small ? size.buttonSmall : size.button,
                  paddingHorizontal: fit === 'whole' ? side : space.x2,
                  paddingVertical: space.x2,
                  borderRadius: radius.control,
                  // Every variant keeps the outline's width, clear where it has none, so a button
                  // does not change size with its state.
                  borderWidth: rule.hairline,
                  borderColor: disabled || look.outline === null ? 'transparent' : look.outline,
                },
                fill === null ? null : { backgroundColor: fill },
              ]}
            >
              {busy ? <PulsingRow>{parts}</PulsingRow> : parts}
            </View>
          );
        }}
      </Pressable>
    </View>
  );
}
