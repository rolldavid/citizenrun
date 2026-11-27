import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { useDip, useOncePerItem } from '@/ui/motion';
import { space } from '@/ui/tokens';

import { DeadlineRing } from './deadline-ring';
import { Flag } from './flag';
import { Notice } from './notice';
import { SourceLink } from './source-link';
import type { SourceLinkProps } from './source-link';
import { Tag } from './tag';
import { Text } from './text';

export type DeadlineBlockProps = {
  /** Where the filing window stands (L-filing-window-state). */
  state: 'unknown' | 'not_open' | 'open' | 'closed';
  /** Open: the days until the window closes, in the jurisdiction's zone. */
  daysLeft: number | null;
  /** "12 days left to file"; "Filing opens in 9 days"; "Filing closed". */
  headline: string;
  /** "5 days to file": takes the headline's place when open with seven days left or fewer. */
  flagLabel: string | null;
  /** The closing date first, with a time only where a source states one; then where to file. */
  lines: readonly string[];
  /** The deadline's source; null only when the state is 'unknown'. */
  source: SourceLinkProps | null;
  /** "Confirm with your election office." (D-515) */
  caution: string;
  /** A deadline conflict: both dates named, the earlier one shown. */
  conflict?: string | null;
  itemKey?: string;
  testID: string;
};

/** The days left at which the headline becomes a flag. */
const FLAG_FROM_DAYS = 7;

const CONFLICT: ViewStyle = { marginBottom: space.x3 };
// The ring, then the words beside it at the ring's middle.
const WITH_RING: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.x4 };
const WORDS: ViewStyle = { flex: 1, minWidth: 0 };
const FLAG: ViewStyle = { alignSelf: 'flex-start', marginBottom: space.x2 };
const UNKNOWN_TAG: ViewStyle = { marginTop: space.x2 };
const SOURCE: ViewStyle = { marginTop: space.x3 };
const CAUTION_AFTER_SOURCE: ViewStyle = { marginTop: space.x2 };
const CAUTION_AFTER_TAG: ViewStyle = { marginTop: space.x3 };

/**
 * C-DeadlineBlock: the filing deadline of an office with its four parts: the date, the confidence
 * and the source in its source row, and the caution line, which every state draws. An open window
 * shows the ring; with seven days left or fewer its headline is a flag, followed by the closing
 * date. Nothing here ticks or converts a time, and only the ring's ticks and the flag's one dip
 * move (MO-deadline-ring).
 */
export function DeadlineBlock({
  state,
  daysLeft,
  headline,
  flagLabel,
  lines,
  source,
  caution,
  conflict = null,
  itemKey,
  testID,
}: DeadlineBlockProps): JSX.Element {
  const open = state === 'open';
  const flagged = open && daysLeft !== null && daysLeft <= FLAG_FROM_DAYS && flagLabel !== null;
  const { shouldPlay, markPlayed } = useOncePerItem('ring', flagged ? itemKey : undefined);
  // Whether the flag dips is settled when the block is first drawn, as the ring's ticks are.
  const [dips] = useState(shouldPlay);
  const [dipPlay, setDipPlay] = useState(false);
  const dip = useDip(dipPlay);

  useEffect(() => {
    if (dips) markPlayed();
  }, [dips, markPlayed]);
  useEffect(() => {
    if (!dips) return undefined;
    // The dip starts from a flag already drawn whole.
    const frame = requestAnimationFrame(() => {
      setDipPlay(true);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [dips]);

  if (__DEV__ && open && daysLeft === null) {
    throw new Error('An open filing window needs its days left.');
  }
  if (__DEV__ && state !== 'unknown' && source === null) {
    throw new Error('A known filing window needs its source.');
  }

  // A window nobody knows has no date to print: its headline stands alone.
  const shown = state === 'unknown' ? [] : lines;
  const words = (
    <>
      {flagged ? (
        <Animated.View style={[FLAG, dip]}>
          <Flag label={flagLabel} />
        </Animated.View>
      ) : (
        <Text role="heading">{headline}</Text>
      )}
      {shown.map((line, index) => (
        // The lines of a block never reorder, so a line's place is its key.
        <Text key={index} role="body">
          {line}
        </Text>
      ))}
    </>
  );

  return (
    <View testID={testID}>
      {conflict === null ? null : (
        <View style={CONFLICT}>
          <Notice kind="warning" text={conflict} />
        </View>
      )}
      {open && daysLeft !== null ? (
        <View style={WITH_RING}>
          <DeadlineRing daysLeft={daysLeft} {...(itemKey === undefined ? {} : { itemKey })} />
          <View style={WORDS}>{words}</View>
        </View>
      ) : (
        words
      )}
      {state === 'unknown' ? (
        <>
          <View style={UNKNOWN_TAG}>
            <Tag variant="unknown" />
          </View>
          <View style={CAUTION_AFTER_TAG}>
            <Text role="label">{caution}</Text>
          </View>
        </>
      ) : (
        <>
          {source === null ? null : (
            <View style={SOURCE}>
              <SourceLink {...source} />
            </View>
          )}
          <View style={CAUTION_AFTER_SOURCE}>
            <Text role="label">{caution}</Text>
          </View>
        </>
      )}
    </View>
  );
}
