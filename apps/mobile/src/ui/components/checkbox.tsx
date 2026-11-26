import { useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import type { LayoutChangeEvent, ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';
import { ToneContext } from '@/ui/tone';

import { Icon } from './icon';
import { Pressable } from './pressable';
import { Text } from './text';

export type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** A string, or a sentence that holds a C-Link (a consent line). */
  label: ReactNode;
  /** The plain accessible name. */
  labelText: string;
  /** Default 'start'; 'end' puts the box at the row's right end (pickers). */
  position?: 'start' | 'end';
  disabled?: boolean;
  testID: string;
};

// The room the row's fill and its focus ring keep at each side of the box and the label. The row
// reaches that far out of its column, so the box stays on the column's edge.
const SIDE = space.x2;
const REACH: ViewStyle = { marginHorizontal: -SIDE };
// The row every checkbox stands in: the box and the label, centered on each other.
const ROW: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x3,
  minHeight: size.target,
  paddingVertical: space.x2,
  paddingHorizontal: SIDE,
};
const WORDS: ViewStyle = { flex: 1 };
const BOX: ViewStyle = {
  width: size.checkbox,
  height: size.checkbox,
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: rule.hairline,
  borderRadius: radius.tag,
};

// A label with a link in it: the row holds the press target and the label side by side.
const SPLIT_ROW: ViewStyle = {
  ...REACH,
  flexDirection: 'row',
  alignItems: 'center',
  minHeight: size.target,
  paddingHorizontal: SIDE,
};
// The press target lies under the whole row and stands at its middle until the row is measured.
const UNDER: ViewStyle = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  justifyContent: 'center',
};
const TARGET: ViewStyle = { flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE };
const TARGET_END: ViewStyle = { ...TARGET, justifyContent: 'flex-end' };
// The room the box takes beside the label, and the gap between them.
const BESIDE_BOX = size.checkbox + space.x3;
// The label keeps the room a string label has above and below it, clear of the box.
const WORDS_AFTER_BOX: ViewStyle = { flex: 1, paddingVertical: space.x2, marginLeft: BESIDE_BOX };
const WORDS_BEFORE_BOX: ViewStyle = { flex: 1, paddingVertical: space.x2, marginRight: BESIDE_BOX };

/** The box: `surface` with a hairline, ink with the check when ticked, the disabled fill when off. */
function Box({ checked, disabled }: { checked: boolean; disabled: boolean }): JSX.Element {
  const theme = useTheme();
  const fill = disabled
    ? theme.color.disabledBg
    : checked
      ? theme.color.inverseBg
      : theme.color.surface;
  return (
    <View
      style={[
        BOX,
        {
          backgroundColor: fill,
          // A ticked box and a disabled one have no outline of their own: the border takes the fill.
          borderColor: disabled || checked ? fill : theme.color.rule,
        },
      ]}
    >
      {checked ? <Icon name="check" size="small" tone={disabled ? 'disabled' : 'inverse'} /> : null}
    </View>
  );
}

/**
 * C-Checkbox: one yes-or-no choice in a row at least as high as the smallest target. A string label
 * makes the whole row the target. A label that holds a link keeps the link its own target: the
 * press target lies under the row, and the label's own text is no part of it. The tick swaps in one
 * frame (MO-cut). It is never ticked for the person.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  labelText,
  position = 'start',
  disabled = false,
  testID,
}: CheckboxProps): JSX.Element {
  const [rowHeight, setRowHeight] = useState<number | null>(null);
  const box = <Box checked={checked} disabled={disabled} />;
  const toggle = (): void => {
    onChange(!checked);
  };

  if (typeof label === 'string') {
    return (
      <View style={REACH}>
        <Pressable
          role="checkbox"
          label={labelText}
          state={{ checked }}
          haptic="selection"
          feedback="moveAndFill"
          hover="fill"
          disabled={disabled}
          testID={testID}
          onPress={toggle}
        >
          <View style={ROW}>
            {position === 'start' ? box : null}
            <View style={WORDS}>
              <Text role="body" tone={disabled ? 'disabled' : 'primary'}>
                {label}
              </Text>
            </View>
            {position === 'end' ? box : null}
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={SPLIT_ROW}
      onLayout={(event: LayoutChangeEvent) => {
        setRowHeight(event.nativeEvent.layout.height);
      }}
    >
      <View style={UNDER}>
        <Pressable
          role="checkbox"
          label={labelText}
          state={{ checked }}
          haptic="selection"
          feedback="moveAndFill"
          hover="fill"
          disabled={disabled}
          testID={testID}
          onPress={toggle}
        >
          <View
            style={[
              position === 'end' ? TARGET_END : TARGET,
              { minHeight: rowHeight ?? size.target },
            ]}
          >
            {box}
          </View>
        </Pressable>
      </View>
      {/* The label lies over the target and takes no press itself, so its link is pressed alone. */}
      <View
        style={position === 'end' ? WORDS_BEFORE_BOX : WORDS_AFTER_BOX}
        pointerEvents="box-none"
      >
        {disabled ? <ToneContext.Provider value="disabled">{label}</ToneContext.Provider> : label}
      </View>
    </View>
  );
}
