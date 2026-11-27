import { BRAND } from '@citizenrun/shared';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, rule, space } from '@/ui/tokens';

import { Text } from './text';

export type FlagProps = { label: string };

const BLOCK: ViewStyle = {
  alignSelf: 'flex-start',
  borderWidth: rule.hairline,
  borderRadius: radius.none,
  paddingVertical: space.x1,
  paddingHorizontal: space.x2,
};

/**
 * C-Flag: a filing deadline seven days away or fewer, and nothing else. A flat volt block with an
 * ink keyline and ink words, square and never tilted. It is never a target; the closing date
 * follows it in plain type.
 */
export function Flag({ label }: FlagProps): JSX.Element {
  const theme = useTheme();
  if (__DEV__ && label.toLowerCase().includes(BRAND.displayName.toLowerCase())) {
    throw new Error('A flag never carries the product name.');
  }
  return (
    <View
      style={[
        BLOCK,
        { backgroundColor: theme.color.highlight, borderColor: theme.color.onHighlight },
      ]}
    >
      <Text role="monoLabel" tone="onHighlight" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
