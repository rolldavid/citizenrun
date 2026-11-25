import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { space, textScale } from '@/ui/tokens';

import { IssueGridChip } from './issue-chip';

export type IssueGridProps = {
  /** Every issue, in the order they are shown; `label` is a chip's accessible name where `name` is short. */
  issues: readonly { id: string; name: string; label?: string }[];
  /** The group's accessible name: the text of the screen's heading. */
  label?: string;
  selectedIds: readonly string[];
  starredIds: readonly string[];
  maxSelected: number;
  maxStarred: number;
  onToggle: (id: string) => void;
  onToggleStar: (id: string) => void;
  /** A tap past `maxSelected`, or a star past `maxStarred`: nothing changes and the screen says why. */
  onLimit: (limit: 'selected' | 'starred') => void;
  testID: string;
};

type GridIssue = IssueGridProps['issues'][number];

const GRID: ViewStyle = { gap: space.x1 };
const ROW: ViewStyle = { flexDirection: 'row', gap: space.x2 };
// A row, so its chip is as high as the cell by stretching.
const CELL: ViewStyle = { flex: 1, minWidth: 0, flexDirection: 'row' };

/** The issues in rows of `perRow`, in their own order. */
function rowsOf(issues: readonly GridIssue[], perRow: number): GridIssue[][] {
  const rows: GridIssue[][] = [];
  for (let start = 0; start < issues.length; start += perRow) {
    rows.push(issues.slice(start, start + perRow));
  }
  return rows;
}

/**
 * C-IssueGrid: every issue on one screen, as two equal columns of chips, and one column on a
 * tight layout. A row is as high as its taller chip. The chips keep the order they are given:
 * selecting never moves one. Past either limit a tap changes nothing and `onLimit` is called.
 */
export function IssueGrid({
  issues,
  label,
  selectedIds,
  starredIds,
  maxSelected,
  maxStarred,
  onToggle,
  onToggleStar,
  onLimit,
  testID,
}: IssueGridProps): JSX.Element {
  const { t } = useTranslation('common');
  const layout = useBreakpoint();
  const theme = useTheme();
  // One column on a tight layout. A development screen's own text size counts as the system's does,
  // so a review of large text in a browser shows the grid a phone draws.
  const tight = layout.isTight || (layout.isNarrow && theme.textScale >= textScale.tightFrom);
  const perRow = tight ? 1 : 2;

  const press = (id: string, selected: boolean): void => {
    if (selected || selectedIds.length < maxSelected) {
      onToggle(id);
    } else {
      onLimit('selected');
    }
  };
  const pressStar = (id: string, starred: boolean): void => {
    if (starred || starredIds.length < maxStarred) {
      onToggleStar(id);
    } else {
      onLimit('starred');
    }
  };

  return (
    <View role="group" aria-label={label} style={GRID} testID={testID}>
      {rowsOf(issues, perRow).map((row) => (
        <View key={row[0]?.id} style={ROW}>
          {row.map((item) => {
            const selected = selectedIds.includes(item.id);
            const starred = starredIds.includes(item.id);
            return (
              <View key={item.id} style={CELL}>
                <IssueGridChip
                  issueId={item.id}
                  name={item.name}
                  label={item.label ?? item.name}
                  size="md"
                  selected={selected}
                  onPress={() => {
                    press(item.id, selected);
                  }}
                  star={
                    selected
                      ? {
                          starred,
                          label: t('ui.issueGrid.star', { name: item.name }),
                          onToggle: () => {
                            pressStar(item.id, starred);
                          },
                        }
                      : null
                  }
                  testID={`${testID}-${item.id}`}
                />
              </View>
            );
          })}
          {/* An odd issue out keeps its column: the last row holds an empty cell beside it. */}
          {row.length < perRow ? <View style={CELL} /> : null}
        </View>
      ))}
    </View>
  );
}
