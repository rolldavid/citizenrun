import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';

export type ProgressProps =
  | {
      kind: 'steps';
      total: number;
      done: number;
      /** The accessible name: "Step 4 of 5". */
      label: string;
    }
  | {
      kind: 'amount';
      value: number;
      max: number;
      /** The accessible name. */
      label: string;
    };

const STEPS: ViewStyle = { flexDirection: 'row', gap: space.x1 };
const BAR: ViewStyle = { flex: 1, height: size.progress, borderRadius: radius.none };
const TRACK: ViewStyle = { height: size.progress, borderRadius: radius.none };
// The outline of the whole track, under the fill.
const OUTLINE: ViewStyle = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  borderWidth: rule.hairline,
};
const FILL: ViewStyle = { height: '100%' };

/** The share of `max` that `value` is, from 0 to 1; nothing of a `max` that is not above 0. */
function shareOf(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) {
    return 0;
  }
  return Math.min(value / max, 1);
}

/** The places of the bars: one for each whole step. */
function placesOf(total: number): number[] {
  return Array.from({ length: Math.max(0, Math.floor(total)) }, (_, place) => place);
}

/**
 * C-Progress: steps done, or an amount done. Done is solid `text` and the rest is a hairline
 * outline in `textSecondary`; no color and no numeral. A new value is drawn in one frame: nothing
 * of it animates.
 */
export function Progress(props: ProgressProps): JSX.Element {
  const theme = useTheme();
  const steps = props.kind === 'steps';
  const max = steps ? props.total : props.max;
  const now = steps ? props.done : props.value;
  const solid: ViewStyle = { backgroundColor: theme.color.text };
  const outlined: ViewStyle = {
    borderWidth: rule.hairline,
    borderColor: theme.color.textSecondary,
  };

  return (
    <View
      style={steps ? STEPS : TRACK}
      accessible={true}
      role="progressbar"
      aria-label={props.label}
      accessibilityValue={{ min: 0, max, now }}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={now}
    >
      {steps ? (
        placesOf(props.total).map((place) => (
          <View key={place} style={[BAR, place < props.done ? solid : outlined]} />
        ))
      ) : (
        <>
          <View style={[OUTLINE, { borderColor: theme.color.textSecondary }]} />
          <View
            style={[FILL, solid, { width: `${String(shareOf(props.value, props.max) * 100)}%` }]}
          />
        </>
      )}
    </View>
  );
}
