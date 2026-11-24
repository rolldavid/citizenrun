import type { JSX, ReactNode } from 'react';
import { ScrollView } from 'react-native';
import type { ViewStyle } from 'react-native';

import { size, space } from '@/ui/tokens';

export type RightColumnProps = {
  /** The modules, in order. */
  children: ReactNode;
};

const COLUMN: ViewStyle = { flexGrow: 0, width: size.rightColumn, marginLeft: size.columnGap };
const MODULES: ViewStyle = { paddingTop: space.x6, gap: space.x6 };

/**
 * C-RightColumn: the right column of the expanded shell. It stays in place while the feed column
 * scrolls, and scrolls by itself when it is taller than the window. It never decides whether it
 * shows: the screen's frame does.
 */
export function RightColumn({ children }: RightColumnProps): JSX.Element {
  return (
    <ScrollView style={COLUMN} contentContainerStyle={MODULES}>
      {children}
    </ScrollView>
  );
}
