import { assertNever } from '@citizenrun/shared';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import type { DisplayValue } from '@/ui/display-value';
import { motion, useOncePerItem, useRise } from '@/ui/motion';
import { space } from '@/ui/tokens';
import type { TypeRole } from '@/ui/typography';

import { Tag } from './tag';
import { Text } from './text';

export type BigNumberProps = {
  /** The figure, formatted. A null text reads "not known yet"; `about` says "about" before it. */
  value: DisplayValue;
  /** What the figure counts, under it: "a year", "votes to win". */
  label: string;
  size: 'hero' | 'display' | 'title' | 'heading';
  /** Lets the figure rise once, the first time this item is seen. */
  itemKey?: string;
  /** The whole sentence a screen reader hears: "About 2,100 votes to win." */
  accessibilityLabel: string;
  testID?: string;
};

// The word "about" stands on the figure's baseline, 8 points before it.
const FIGURE_ROW: ViewStyle = { flexDirection: 'row', alignItems: 'baseline', gap: space.x2 };
// The figure gives way where the row is too narrow for it, and ends in an ellipsis.
const FIGURE: ViewStyle = { flexShrink: 1, minWidth: 0 };
const LABEL: ViewStyle = { marginTop: space.x1 };

/** The numeral role of each size. */
function roleOf(size: BigNumberProps['size']): TypeRole {
  switch (size) {
    case 'hero':
      return 'numeralHero';
    case 'display':
      return 'numeralDisplay';
    case 'title':
      return 'numeralTitle';
    case 'heading':
      return 'numeralHeading';
    default:
      return assertNever(size);
  }
}

/**
 * C-BigNumber: the one large figure of a section, with its label under it. An estimate says
 * "about" before the figure, and a value nobody knows is the unknown tag in the figure's place.
 * The figure is its true value from its first frame: it rises once and never counts up
 * (MO-meters). A screen reader hears one element, the caller's sentence.
 */
export function BigNumber({
  value,
  label,
  size,
  itemKey,
  accessibilityLabel,
  testID,
}: BigNumberProps): JSX.Element {
  const { t } = useTranslation('common');
  const { shouldPlay, markPlayed } = useOncePerItem(
    'number',
    value.text === null ? undefined : itemKey,
  );
  // Whether this figure rises is settled when it is first drawn.
  const [rises] = useState(shouldPlay);
  const [risen, setRisen] = useState(false);
  const rise = useRise(risen, motion.distance.riseNumber, motion.duration.rise);

  useEffect(() => {
    if (rises) markPlayed();
  }, [rises, markPlayed]);
  useEffect(() => {
    if (!rises) return undefined;
    // The figure is drawn at its start first, so the rise has somewhere to come from.
    const frame = requestAnimationFrame(() => {
      setRisen(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [rises]);

  const figure =
    value.text === null ? (
      <Tag variant="unknown" />
    ) : (
      <>
        {value.about ? <Text role="bodyStrong">{t('about')}</Text> : null}
        <View style={FIGURE}>
          <Text role={roleOf(size)} numberOfLines={1}>
            {value.text}
          </Text>
        </View>
      </>
    );

  return (
    // `accessible` makes the figure and its label one element for the phone's screen reader.
    <View accessible={true} role="img" aria-label={accessibilityLabel} testID={testID}>
      <View
        aria-hidden={true}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
      >
        {rises ? (
          <Animated.View style={[FIGURE_ROW, rise]}>{figure}</Animated.View>
        ) : (
          <View style={FIGURE_ROW}>{figure}</View>
        )}
        <View style={LABEL}>
          <Text role="monoLabel">{label}</Text>
        </View>
      </View>
    </View>
  );
}
