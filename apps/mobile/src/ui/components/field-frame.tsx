import type { JSX, ReactNode } from 'react';
import { Pressable as NativePressable, View } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';

import { focusRingStyle } from '@/ui/focus';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';

export type FieldFrameProps = {
  status: 'none' | 'error' | 'valid';
  /** Draws the focus ring round the frame: the input inside it draws none of its own. */
  focused: boolean;
  disabled?: boolean;
  /**
   * True while the press target round the frame paints a hover or a pressed fill: the frame leaves
   * its own ground out, so the fill shows inside its border. A field that is typed in never passes
   * it.
   */
  clear?: boolean;
  /** Squares the bottom corners off: a list joined to the frame stands under it. Default false. */
  squareBottom?: boolean;
  /** Before the text, `space.x2` from it. */
  leading?: ReactNode;
  /** After the text, `space.x2` from it. */
  trailing?: ReactNode;
  /** A press on the frame's own room, round what it holds: a field hands its input the focus. */
  onPress?: () => void;
  children: ReactNode;
};

const ROW: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x2,
  minHeight: size.input,
  borderRadius: radius.control,
};
// The frame is no button: it only hands a press on to its input.
const PLAIN_CURSOR: ViewStyle = { cursor: 'auto' };

/** Scales one measure of a type role; a role without it has none to scale. */
function times(value: number | undefined, factor: number): number | undefined {
  return value === undefined ? undefined : value * factor;
}

/**
 * The style of text typed into a field: the `body` role at the text size in use, in `text`, or in
 * `disabledText` where the field is off. It fills the frame's row and has no padding and no outline
 * of its own, so the frame alone draws the box and the focus ring.
 */
export function useFieldTextStyle(disabled: boolean): TextStyle {
  const theme = useTheme();
  const body = typography.body.style;
  return {
    ...body,
    fontSize: times(body.fontSize, theme.textScale),
    lineHeight: times(body.lineHeight, theme.textScale),
    letterSpacing: times(body.letterSpacing, theme.textScale),
    color: disabled ? theme.color.disabledText : theme.color.text,
    flex: 1,
    minWidth: 0,
    padding: 0,
    // A style of its own replaces the browser's ring, which a width alone does not.
    outlineStyle: 'solid',
    outlineWidth: 0,
  };
}

/**
 * The box every field shares, so they cannot drift: a row at least `size.input` high on `surface`
 * with a hairline of `rule`. An error or a valid state thickens the border in its color, and a
 * disabled field gives its border up for the disabled fill. The room inside takes back what the
 * border gains or loses, so the text never moves when the state changes. A frame that is pressed,
 * not typed in, is `clear` while its press target fills it.
 */
export function FieldFrame({
  status,
  focused,
  disabled = false,
  clear = false,
  squareBottom = false,
  leading,
  trailing,
  onPress,
  children,
}: FieldFrameProps): JSX.Element {
  const theme = useTheme();
  const marked = !disabled && status !== 'none';
  const border = disabled ? 0 : marked ? rule.fieldState : rule.hairline;
  // What the border takes beyond a hairline: the padding gives the same back.
  const extra = border - rule.hairline;
  const style: ViewStyle = {
    ...ROW,
    // The disabled fill is the frame's own, whatever is under it.
    ...(disabled
      ? { backgroundColor: theme.color.disabledBg }
      : clear
        ? {}
        : { backgroundColor: theme.color.surface }),
    borderWidth: border,
    borderColor:
      status === 'error'
        ? theme.color.danger
        : status === 'valid'
          ? theme.color.success
          : theme.color.rule,
    paddingHorizontal: space.x4 - extra,
    paddingVertical: space.x1 - extra,
    ...(focused ? focusRingStyle(theme, radius.control) : {}),
    ...(squareBottom
      ? { borderBottomLeftRadius: radius.none, borderBottomRightRadius: radius.none }
      : {}),
  };
  const content = (
    <>
      {leading}
      {children}
      {trailing}
    </>
  );

  if (onPress === undefined || disabled) {
    return <View style={style}>{content}</View>;
  }
  return (
    <NativePressable
      accessible={false}
      focusable={false}
      tabIndex={-1}
      style={[style, PLAIN_CURSOR]}
      onPress={onPress}
    >
      {content}
    </NativePressable>
  );
}
