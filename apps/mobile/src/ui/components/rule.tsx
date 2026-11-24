import type { JSX } from 'react';
import { View } from 'react-native';

import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { rule } from '@/ui/tokens';

export type RuleProps = {
  /** 'strong' starts a group or tops a bar or a sheet; 'soft' sits between rows inside a group. */
  variant: 'strong' | 'soft';
  /** Default 'none'; 'gutter' holds the rule in from each side by the screen's gutter. */
  inset?: 'none' | 'gutter';
};

/** C-Rule: the two straight rules of the system. Decorative, so hidden from screen readers. */
export function Rule({ variant, inset = 'none' }: RuleProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  return (
    <View
      style={{
        alignSelf: 'stretch',
        height: rule.hairline,
        backgroundColor: variant === 'strong' ? theme.color.rule : theme.color.ruleSoft,
        marginHorizontal: inset === 'gutter' ? layout.gutter : 0,
      }}
      aria-hidden={true}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    />
  );
}
