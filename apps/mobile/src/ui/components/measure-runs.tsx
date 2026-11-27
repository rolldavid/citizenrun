import type { JSX } from 'react';
import { View } from 'react-native';
import type { LayoutChangeEvent, ViewStyle } from 'react-native';

import type { TypeRole } from '@/ui/typography';

import { Text } from './text';

// Out of the layout and never seen: each run set at its own width on one line.
const MEASURE: ViewStyle = {
  position: 'absolute',
  top: 0,
  left: 0,
  height: 0,
  overflow: 'hidden',
  flexDirection: 'row',
};
const RUN: ViewStyle = { position: 'absolute', top: 0, left: 0 };

/** The words of a text, as a line breaks between them. */
export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== '');
}

export type MeasureRunsProps = {
  role: TypeRole;
  /** Each text to measure, set on one line. */
  runs: readonly string[];
  /** The width of the run at `index` once it is laid out. */
  onRun: (index: number, width: number) => void;
};

/**
 * Sets each run on one line out of sight and reports its width, so a part can tell what fits before
 * it decides how to draw: a button whether its long label stands on one line, a credit how wide its
 * longest word is. Nothing here is seen, pressed or read.
 */
export function MeasureRuns({ role, runs, onRun }: MeasureRunsProps): JSX.Element {
  return (
    <View
      style={MEASURE}
      pointerEvents="none"
      aria-hidden={true}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      {runs.map((run, index) => (
        <View
          key={`${String(index)}-${run}`}
          style={RUN}
          onLayout={(event: LayoutChangeEvent) => {
            onRun(index, event.nativeEvent.layout.width);
          }}
        >
          <Text role={role} numberOfLines={1}>
            {run}
          </Text>
        </View>
      ))}
    </View>
  );
}
