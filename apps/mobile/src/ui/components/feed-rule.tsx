import type { JSX } from 'react';
import { View } from 'react-native';
import { Line, Svg } from 'react-native-svg';

import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { gutter, rule } from '@/ui/tokens';

/** C-FeedRule takes no props. */
export type FeedRuleProps = Record<string, never>;

/**
 * C-FeedRule: the dotted rule between feed items, and nowhere else. One dashed line with butt caps
 * draws its row of squares (PC6A-11). Decorative, so hidden from screen readers.
 */
export function FeedRule(): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const middle = rule.dottedSquare / 2;
  return (
    <View
      style={{
        alignSelf: 'stretch',
        paddingHorizontal: layout.breakpoint === 'compact' ? layout.gutter : gutter.feedColumnWide,
      }}
      pointerEvents="none"
      aria-hidden={true}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width="100%" height={rule.dottedSquare}>
        <Line
          x1={0}
          y1={middle}
          x2="100%"
          y2={middle}
          stroke={theme.color.rule}
          strokeWidth={rule.dottedSquare}
          strokeDasharray={[rule.dottedSquare, rule.dottedPitch - rule.dottedSquare]}
          strokeLinecap="butt"
        />
      </Svg>
    </View>
  );
}
