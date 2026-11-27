import { assertNever } from '@citizenrun/shared';
import type { TFunction } from '@citizenrun/shared';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { space } from '@/ui/tokens';

import { Flag } from './flag';
import { Text } from './text';

export type DeadlineLineProps = {
  variant: 'card' | 'row';
  /** The line, already translated: `closingLineText` builds a card's, `closingRowText` a row's. */
  text: string;
  /** Row: "5 days to file", drawn as a flag before the date at seven days or fewer. */
  flagLabel?: string | null;
  testID?: string;
};

export type ClosingInput = {
  state: 'unknown' | 'not_open' | 'open' | 'closed' | 'none';
  date: string | null;
  time: string | null;
};

/** The date of a state that names one. */
function dateOf(input: ClosingInput): string {
  if (input.date === null) {
    throw new RangeError('An open, not-open or closed filing window needs its date.');
  }
  return input.date;
}

/** The closing line under every office card; `date` and `time` arrive formatted (formatDate 'weekdayShort', formatLocalTime). Throws RangeError when an open, not-open or closed state has no date. */
export function closingLineText(input: ClosingInput, t: TFunction): string {
  switch (input.state) {
    case 'open':
      // A closing time is said only when a source states one.
      return input.time === null
        ? t('common:ui.closing.closes', { date: dateOf(input) })
        : t('common:ui.closing.closesAt', { date: dateOf(input), time: input.time });
    case 'not_open':
      return t('common:ui.closing.opens', { date: dateOf(input) });
    case 'closed':
      return t('common:ui.closing.closed', { date: dateOf(input) });
    case 'unknown':
      return t('common:ui.closing.unknown');
    case 'none':
      return t('common:ui.closing.none');
    default:
      return assertNever(input.state);
  }
}

/** The short form a list row shows, from the same input. */
export function closingRowText(input: ClosingInput, t: TFunction): string {
  switch (input.state) {
    case 'open':
      // A closing time is said only when a source states one (D-641).
      return input.time === null
        ? t('common:ui.closingRow.closes', { date: dateOf(input) })
        : t('common:ui.closingRow.closesAt', { date: dateOf(input), time: input.time });
    case 'not_open':
      return t('common:ui.closingRow.opens', { date: dateOf(input) });
    case 'closed':
      return t('common:ui.closingRow.closed', { date: dateOf(input) });
    case 'unknown':
      return t('common:ui.closingRow.unknown');
    case 'none':
      return t('common:ui.closingRow.none');
    default:
      return assertNever(input.state);
  }
}

// The flag, then the date; the date goes under a flag too wide to share its line.
const FLAGGED: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: space.x2,
};
const DATE: ViewStyle = { flexShrink: 1 };

/**
 * C-DeadlineLine: the closing line in native text, under every office card and in a row, so the
 * date grows with the text size and survives a crop. A date a person acts on is set in the text
 * color: never grey, never mono, and never a day count without its date.
 */
export function DeadlineLine({
  variant,
  text,
  flagLabel = null,
  testID,
}: DeadlineLineProps): JSX.Element {
  const id = testID === undefined ? {} : { testID };
  if (variant === 'card') {
    return (
      <Text role="label" tone="primary" {...id}>
        {text}
      </Text>
    );
  }
  if (flagLabel === null) {
    return (
      <Text role="caption" tone="primary" {...id}>
        {text}
      </Text>
    );
  }
  return (
    <View style={FLAGGED} testID={testID}>
      <Flag label={flagLabel} />
      <View style={DATE}>
        <Text role="caption" tone="primary">
          {text}
        </Text>
      </View>
    </View>
  );
}
