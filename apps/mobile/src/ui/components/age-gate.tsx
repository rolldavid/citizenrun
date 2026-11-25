import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { space } from '@/ui/tokens';

import { Select } from './select';

export type AgeGateProps = {
  /** 1 to 12; null until the person chooses. */
  month: number | null;
  /** Null until the person chooses. */
  year: number | null;
  /** The years offered, newest first. */
  years: readonly number[];
  onChange: (value: { month: number | null; year: number | null }) => void;
  monthLabel: string;
  yearLabel: string;
  monthPlaceholder: string;
  yearPlaceholder: string;
  /** The twelve month names, January first. */
  monthNames: readonly string[];
  testIDs: { month: string; year: string };
};

const SIDE_BY_SIDE: ViewStyle = { flexDirection: 'row', alignItems: 'flex-start', gap: space.x3 };
const STACKED: ViewStyle = { gap: space.x3 };
// Side by side the month takes the wider share: its names are longer than a year.
const MONTH_SHARE: ViewStyle = { flex: 3 };
const YEAR_SHARE: ViewStyle = { flex: 2 };

/**
 * C-AgeGate: the date-of-birth question of sign-up (D-350): a month and a year, each a C-Select
 * with nothing chosen. It says nothing about which answer passes, and every word it shows is the
 * caller's. The answer is the caller's too: this holds no copy of it.
 */
export function AgeGate({
  month,
  year,
  years,
  onChange,
  monthLabel,
  yearLabel,
  monthPlaceholder,
  yearPlaceholder,
  monthNames,
  testIDs,
}: AgeGateProps): JSX.Element {
  const { isTight } = useBreakpoint();

  const monthSelect = (
    <Select
      label={monthLabel}
      placeholder={monthPlaceholder}
      value={month === null ? null : String(month)}
      options={monthNames.map((name, index) => ({ value: String(index + 1), label: name }))}
      onChange={(next) => {
        onChange({ month: Number(next), year });
      }}
      testID={testIDs.month}
    />
  );
  const yearSelect = (
    <Select
      label={yearLabel}
      placeholder={yearPlaceholder}
      value={year === null ? null : String(year)}
      options={years.map((each) => ({ value: String(each), label: String(each) }))}
      onChange={(next) => {
        onChange({ month, year: Number(next) });
      }}
      testID={testIDs.year}
    />
  );

  if (isTight) {
    return (
      <View style={STACKED}>
        {monthSelect}
        {yearSelect}
      </View>
    );
  }
  return (
    <View style={SIDE_BY_SIDE}>
      <View style={MONTH_SHARE}>{monthSelect}</View>
      <View style={YEAR_SHARE}>{yearSelect}</View>
    </View>
  );
}
