import { BRAND } from '@citizenrun/shared';
import type { JSX, ReactNode } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { rule, space } from '@/ui/tokens';

import { Text } from './text';

export type SectionHeaderProps = {
  /** Four words at most, and never the product's name. */
  label: string;
  /** At the right of the label's line: a count in mono, a small quiet button. */
  trailing?: ReactNode;
  /** The heading level; default 2. */
  level?: 2 | 3;
};

const MOST_WORDS = 4;

const LINE: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: space.x3,
  paddingTop: space.x3,
  paddingBottom: space.x2,
  borderTopWidth: rule.hairline,
};
const LABEL: ViewStyle = { flexShrink: 1 };

/** Throws for a label that breaks the rules of a mono label. Development only. */
function checkLabel(label: string): void {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length > MOST_WORDS) {
    throw new Error('A section label has four words at most');
  }
  if (label.toLowerCase().includes(BRAND.displayName.toLowerCase())) {
    throw new Error('A section label never holds the product name');
  }
}

/**
 * C-SectionHeader: starts a group on a page, a sheet or the right column. A rule, then the label
 * in capitals with whatever trails it on the same line. It keeps no room above its rule: the
 * screen sets the space before a section.
 */
export function SectionHeader({ label, trailing, level = 2 }: SectionHeaderProps): JSX.Element {
  const theme = useTheme();
  if (__DEV__) {
    checkLabel(label);
  }
  return (
    <View style={[LINE, { borderTopColor: theme.color.rule }]}>
      <View style={LABEL}>
        <Text role="monoLabel" heading={level}>
          {label}
        </Text>
      </View>
      {trailing}
    </View>
  );
}
