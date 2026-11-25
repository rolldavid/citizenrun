import { assertNever } from '@citizenrun/shared';
import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import type { HapticName } from '@/ui/haptic';
import type { IconName } from '@/ui/icons';
import { usePulse } from '@/ui/motion';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';
import type { ThemeColors } from '@/ui/tokens';
import type { ResolvedTone } from '@/ui/tone';

import { Icon } from './icon';
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
  haptic,
  testID,
}: ButtonProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const look = lookOf(variant, theme.color);
  const small = sizeName === 'sm';
  const tone: ResolvedTone = disabled ? 'disabled' : look.tone;
  const leading: IconName | undefined = done ? 'check' : icon;
  // The accessible name stays the long label.
  const words = layout.isTight && shortLabel !== undefined ? shortLabel : label;

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
    <View style={{ alignSelf: fullWidth ? 'stretch' : 'flex-start' }}>
      <Pressable
        role={href === undefined ? 'button' : 'link'}
        label={label}
        disabled={disabled}
        state={{ busy }}
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
                  paddingHorizontal: variant === 'quiet' ? space.x2 : small ? space.x3 : space.x4,
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
