import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Skeleton } from '@/ui/components/skeleton';
import { size, space } from '@/ui/tokens';

import { useTight } from './use-tight';

/** The grid shows ten rows of chips. */
const ROWS = 10;

const GRID: ViewStyle = { gap: space.x1 };
const ROW: ViewStyle = { flexDirection: 'row', gap: space.x2 };
const CELL: ViewStyle = { flex: 1 };

/** Out of a screen reader's way: every block after the first, which says nothing new. */
const QUIET = {
  'aria-hidden': true,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/**
 * The issue grid before the issues have come: flat blocks in the grid's shape, two to a row and
 * one to a row where the grid draws one column. A screen reader meets one progress bar.
 */
export function IssuesSkeleton(): JSX.Element {
  const perRow = useTight() ? 1 : 2;
  return (
    <View style={GRID}>
      {Array.from({ length: ROWS }, (_row, row) => (
        <View key={row} style={ROW}>
          {Array.from({ length: perRow }, (_cell, cell) => (
            <View key={cell} style={CELL} {...(row === 0 && cell === 0 ? {} : QUIET)}>
              <Skeleton shape="block" height={size.chip} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
