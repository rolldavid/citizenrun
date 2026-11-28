import { clamp, roundHalfAwayFromZero } from '@citizenrun/shared';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { motion, useOncePerItem, useStagger } from '@/ui/motion';
import type { AnimatedStyle } from '@/ui/motion';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';

import { Icon } from './icon';
import { Pressable } from './pressable';
import { Text } from './text';

export type MeterProps = {
  form: 'feed' | 'page';
  /** "Ease", "Impact". */
  name: string;
  /** 0 to 100; null is "not known yet". */
  score: number | null;
  /** "Easier than most"; it begins with "about" when the confidence is low. */
  phrase: string | null;
  /** Page form: the inputs panel under the meter is open. */
  expanded?: boolean;
  /** Feed: opens the office page at its effort section. Page: opens and closes the panel. */
  onPress: () => void;
  /** Lets the lit pips cut on once, the first time this item is seen. */
  itemKey?: string;
  testID: string;
};

// One target, at least as high as the smallest one.
const FEED: ViewStyle = { minHeight: size.target };
const PAGE: ViewStyle = { minHeight: size.target, justifyContent: 'center' };
const FEED_NAME_ROW: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  marginBottom: space.x1,
};
const FEED_NAME: ViewStyle = { flex: 1, minWidth: 0 };
const FEED_PHRASE: ViewStyle = { marginTop: space.x1 };
const PAGE_ROW: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x2,
  marginBottom: space.x2,
};
const PAGE_PHRASE: ViewStyle = { flex: 1, minWidth: 0 };
const PIPS: ViewStyle = { flexDirection: 'row', gap: space.pip };
const PIP: ViewStyle = { flex: 1, borderRadius: radius.none };
// Out of the meter's layout, so a word space takes no room in it.
const WORD_SPACE: ViewStyle = { position: 'absolute' };

/**
 * A space between the name and the phrase. Each stands in a box of its own with nothing between
 * them in the page's text, where the name would run into the phrase's first word and the meter's
 * text would not read as its name does. It draws nothing and no screen reader meets it.
 */
function WordSpace(): JSX.Element {
  return (
    <View style={WORD_SPACE}>
      <Text role="caption" hidden={true}>
        {' '}
      </Text>
    </View>
  );
}

/** The top of a score's range. */
const SCORE_MAX = 100;
/** The points of a score one pip stands for. */
const POINTS_PER_PIP = SCORE_MAX / size.meterPips;

/** How many of the pips a score lights: its share of the scale, rounded half away from zero. */
function litOf(score: number | null): number {
  return score === null
    ? 0
    : clamp(roundHalfAwayFromZero(score / POINTS_PER_PIP), 0, size.meterPips);
}

type PipsProps = {
  lit: number;
  height: number;
  /** The style that cuts a lit pip on in its turn; null where nothing plays. */
  cutOn: ((index: number) => AnimatedStyle) | null;
};

/** The scale of ten: lit pips solid, the rest outlined, so the whole scale always shows. */
function Pips({ lit, height, cutOn }: PipsProps): JSX.Element {
  const theme = useTheme();
  const solid: ViewStyle = { height, backgroundColor: theme.color.text };
  const outlined: ViewStyle = {
    height,
    borderWidth: rule.hairline,
    borderColor: theme.color.textSecondary,
  };
  return (
    <View style={PIPS}>
      {Array.from({ length: size.meterPips }, (_, index) =>
        index >= lit ? (
          // An unlit pip never animates.
          <View key={index} style={[PIP, outlined]} />
        ) : cutOn === null ? (
          <View key={index} style={[PIP, solid]} />
        ) : (
          <Animated.View key={index} style={[PIP, solid, cutOn(index)]} />
        ),
      )}
    </View>
  );
}

/**
 * C-Meter: Ease or Impact as ten counted pips and a phrase, never a number, a color or a filled
 * bar. A score nobody knows is ten outlines and "not known yet"; low confidence changes the phrase
 * alone. The whole meter is one target. On first view the lit pips cut on from the left, once per
 * item (MO-meters).
 */
export function Meter({
  form,
  name,
  score,
  phrase,
  expanded = false,
  onPress,
  itemKey,
  testID,
}: MeterProps): JSX.Element {
  const { t } = useTranslation('common');
  const lit = litOf(score);
  const words = score === null || phrase === null ? t('notKnownYet') : phrase;
  const { shouldPlay, markPlayed } = useOncePerItem('meters', lit > 0 ? itemKey : undefined);
  // Whether the pips cut on is settled when the meter is first drawn.
  const [plays] = useState(shouldPlay);
  const stagger = useStagger(size.meterPips, motion.duration.pipStagger, plays);
  useEffect(() => {
    if (plays) markPlayed();
  }, [plays, markPlayed]);

  const label = t('ui.meter.outOfTen', { name, phrase: words, count: lit });
  const cutOn = plays ? stagger : null;

  if (form === 'feed') {
    return (
      <Pressable
        role="button"
        label={label}
        feedback="fill"
        hover="fill"
        radius={radius.none}
        testID={testID}
        onPress={onPress}
      >
        <View style={FEED}>
          <View style={FEED_NAME_ROW}>
            <View style={FEED_NAME}>
              <Text role="monoLabel">{name}</Text>
            </View>
            <Icon name="chevronRight" size="small" tone="secondary" />
          </View>
          <WordSpace />
          <Pips lit={lit} height={size.meterPipFeed} cutOn={cutOn} />
          <View style={FEED_PHRASE}>
            <Text role="label">{words}</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      role="button"
      label={label}
      state={{ expanded }}
      feedback="fill"
      hover="fill"
      radius={radius.none}
      testID={testID}
      onPress={onPress}
    >
      <View style={PAGE}>
        <View style={PAGE_ROW}>
          <Text role="monoLabel">{name}</Text>
          <WordSpace />
          <View style={PAGE_PHRASE}>
            <Text role="label" align="end">
              {words}
            </Text>
          </View>
          {/* The chevron swaps in one frame: a cut. */}
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size="medium" />
        </View>
        <Pips lit={lit} height={size.meterPipPage} cutOn={cutOn} />
      </View>
    </Pressable>
  );
}
