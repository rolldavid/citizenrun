import { clamp, formatNumber } from '@citizenrun/shared';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { motion, useOncePerItem, useStagger } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import { radius, rule, size } from '@/ui/tokens';

import { Text } from './text';

export type DeadlineRingProps = {
  /** The days left to file: one lit tick for each, up to thirty. */
  daysLeft: number;
  /** The side of the ring's box; default and smallest `size.deadlineRingMin`. */
  size?: number;
  /** Lets the lit ticks cut on once, the first time this item is seen. */
  itemKey?: string;
};

/** The degrees of a full turn, shared out among the ticks. */
const TURN = 360;
const STEP = TURN / size.ring.ticks;

const CENTER: ViewStyle = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  alignItems: 'center',
  justifyContent: 'center',
};

/**
 * C-DeadlineRing: the days left to file as a dial of thirty ticks, one for each day, lit clockwise
 * from twelve o'clock, with the count in its center. The ticks are plain rotated rectangles, so
 * they cut on by opacity alone, once per item (MO-deadline-ring); the count never moves and the
 * ring never changes color. It is decoration to a screen reader: the words beside it say the days.
 */
export function DeadlineRing({
  daysLeft,
  size: side = size.deadlineRingMin,
  itemKey,
}: DeadlineRingProps): JSX.Element {
  const theme = useTheme();
  const { i18n } = useTranslation('common');
  const lit = clamp(daysLeft, 0, size.ring.ticks);
  const { shouldPlay, markPlayed } = useOncePerItem('ring', lit > 0 ? itemKey : undefined);
  // Whether the ticks cut on is settled when the ring is first drawn.
  const [plays] = useState(shouldPlay);
  const stagger = useStagger(size.ring.ticks, motion.duration.ringStagger, plays);
  useEffect(() => {
    if (plays) markPlayed();
  }, [plays, markPlayed]);

  if (__DEV__ && side < size.deadlineRingMin) {
    throw new Error('A deadline ring is never smaller than its smallest size.');
  }

  const width = size.ring.tickShare * side;
  const length = (size.ring.outerShare - size.ring.innerShare) * side;
  // How far from the center the middle of a tick stands.
  const reach = ((size.ring.innerShare + size.ring.outerShare) / 2) * side;
  const tick: ViewStyle = {
    position: 'absolute',
    left: (side - width) / 2,
    top: (side - length) / 2,
    width,
    height: length,
    borderRadius: radius.none,
  };
  const solid: ViewStyle = { backgroundColor: theme.color.text };
  const outlined: ViewStyle = {
    borderWidth: rule.hairline,
    borderColor: theme.color.textSecondary,
  };

  return (
    <View
      style={{ width: side, height: side }}
      aria-hidden={true}
      accessibilityElementsHidden={true}
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: size.ring.ticks }, (_, index) => {
        // Tick 0 stands at twelve o'clock, and the ticks run clockwise.
        const placed: ViewStyle = {
          transform: [{ rotate: `${String(index * STEP)}deg` }, { translateY: -reach }],
        };
        if (index >= lit) {
          // An unlit tick never animates.
          return <View key={index} style={[tick, placed, outlined]} />;
        }
        return plays ? (
          <Animated.View key={index} style={[tick, placed, solid, stagger(index)]} />
        ) : (
          <View key={index} style={[tick, placed, solid]} />
        );
      })}
      <View style={CENTER}>
        <Text role="numeralTitle">{formatNumber(Math.max(daysLeft, 0), i18n.language)}</Text>
      </View>
    </View>
  );
}
