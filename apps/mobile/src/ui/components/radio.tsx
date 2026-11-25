import type { JSX, Ref } from 'react';
import { View } from 'react-native';
import type { ViewInstance, ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';

import { Pressable } from './pressable';
import { Text } from './text';

export type RadioProps = {
  selected: boolean;
  label: string;
  helper?: string;
  onSelect: () => void;
  /** Default true. A C-RadioGroup leaves only its current option in the Tab order. */
  focusable?: boolean;
  /** Reaches the press target, so a C-RadioGroup can move focus to the option it chooses. */
  ref?: Ref<ViewInstance>;
  testID: string;
};

const ROW: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x3,
  minHeight: size.target,
  paddingVertical: space.x2,
};
const WORDS: ViewStyle = { flex: 1 };
const CIRCLE: ViewStyle = {
  width: size.radio,
  height: size.radio,
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: rule.hairline,
  borderRadius: radius.full,
};
const DOT: ViewStyle = {
  width: size.radioDot,
  height: size.radioDot,
  borderRadius: radius.full,
};

/**
 * C-Radio: one option of a C-RadioGroup, a row at least as high as the smallest target with the
 * whole row the target. The chosen option carries the disc, which appears in one frame (MO-cut).
 */
export function Radio({
  selected,
  label,
  helper,
  onSelect,
  focusable = true,
  ref,
  testID,
}: RadioProps): JSX.Element {
  const theme = useTheme();
  return (
    <Pressable
      role="radio"
      label={label}
      state={{ checked: selected }}
      haptic="selection"
      feedback="moveAndFill"
      hover="fill"
      focusable={focusable}
      testID={testID}
      onPress={onSelect}
      {...(helper === undefined ? {} : { hint: helper })}
      {...(ref === undefined ? {} : { ref })}
    >
      <View style={ROW}>
        <View
          style={[CIRCLE, { backgroundColor: theme.color.surface, borderColor: theme.color.rule }]}
        >
          {selected ? <View style={[DOT, { backgroundColor: theme.color.text }]} /> : null}
        </View>
        <View style={WORDS}>
          <Text role="body">{label}</Text>
          {helper === undefined ? null : (
            <Text role="caption" tone="secondary">
              {helper}
            </Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}
