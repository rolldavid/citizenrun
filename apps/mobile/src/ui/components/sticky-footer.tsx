import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { rule, space, z } from '@/ui/tokens';

import { Button } from './button';
import type { ButtonProps } from './button';
import { Text } from './text';

export type StickyFooterProps = {
  /** At the left: what the buttons will act on. Its helper is dropped on a tight layout. */
  info?: { line: string; helper?: string };
  /** The ink button. A disabled one says why in its label. */
  primary?: Pick<
    ButtonProps,
    'label' | 'shortLabel' | 'onPress' | 'href' | 'disabled' | 'busy' | 'testID'
  >;
  secondary?: Pick<ButtonProps, 'label' | 'onPress' | 'href' | 'testID'> & {
    variant: 'secondary' | 'quiet';
  };
};

const BAR: ViewStyle = {
  zIndex: z.sticky,
  borderTopWidth: rule.hairline,
  paddingTop: space.x3,
};
const ROW: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.x3 };
// A lone secondary button stands at the right.
const ROW_END: ViewStyle = { ...ROW, justifyContent: 'flex-end' };
const INFO: ViewStyle = { flex: 1 };
// The primary button takes the width the row has left.
const FILLS: ViewStyle = { flex: 1 };

/**
 * C-StickyFooter: the bar at the bottom of a flow. `bg` under a hairline of `rule`, clear of the
 * bottom inset. With `info` the buttons stand at the right at their own width; without it the
 * primary button fills the row, after the secondary one. It is never drawn with neither button.
 */
export function StickyFooter({ info, primary, secondary }: StickyFooterProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const insets = useSafeAreaInsets();

  if (__DEV__ && primary === undefined && secondary === undefined) {
    throw new Error('StickyFooter needs a primary or a secondary action');
  }

  const fills = info === undefined && primary !== undefined;
  return (
    <View
      style={[
        BAR,
        {
          backgroundColor: theme.color.bg,
          borderTopColor: theme.color.rule,
          paddingBottom: space.x3 + insets.bottom,
          paddingLeft: layout.gutter + insets.left,
          paddingRight: layout.gutter + insets.right,
        },
      ]}
    >
      <View style={primary === undefined && info === undefined ? ROW_END : ROW}>
        {info === undefined ? null : (
          // What is picked changes as the person picks: a screen reader hears each new count.
          <View style={INFO} accessibilityLiveRegion="polite" aria-live="polite">
            <Text role="label">{info.line}</Text>
            {info.helper === undefined || layout.isTight ? null : (
              <Text role="caption" tone="secondary">
                {info.helper}
              </Text>
            )}
          </View>
        )}
        {secondary === undefined ? null : (
          <View>
            <Button {...secondary} size="md" />
          </View>
        )}
        {primary === undefined ? null : (
          <View style={fills ? FILLS : null}>
            <Button {...primary} variant="primary" size="md" fullWidth={fills} />
          </View>
        )}
      </View>
    </View>
  );
}
