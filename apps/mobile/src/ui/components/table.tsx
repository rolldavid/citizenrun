import { isValidElement, useRef, useState } from 'react';
import type { JSX, ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { KeyDownEvent, ViewInstance, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { isWorkletFunction } from 'react-native-worklets';

import type { DisplayValue } from '@/ui/display-value';
import { useTheme } from '@/ui/theme';
import { radius, rule, size, space, z } from '@/ui/tokens';

import { Pressable } from './pressable';
import { Tag } from './tag';
import { Text } from './text';

export type TableProps = {
  columns: readonly {
    id: string;
    header: string;
    /** Default 'start'. */
    align?: 'start' | 'end';
    /** Right-aligned, with fixed-width digits. */
    numeric?: boolean;
    /** In points; without it the column shares the room the others leave. */
    width?: number;
  }[];
  rows: readonly {
    id: string;
    /** By column id: a value the table draws, or an element drawn as given. */
    cells: Readonly<Record<string, DisplayValue | ReactElement>>;
    onPress?: () => void;
    href?: string;
  }[];
  /** Names the table for a screen reader. */
  caption: string;
  /** Drawn under the header when there are no rows. */
  empty?: ReactElement;
  testID: string;
};

type Column = TableProps['columns'][number];
type Row = TableProps['rows'][number];

/** What only the web reads of a cell that spans columns; React Native's own types leave it out. */
type WebSpanProps = { 'aria-colspan'?: number };

// The rows are a column inside the sideways scroller, at least as wide as the table's own box.
const CONTENT: ViewStyle = { flexDirection: 'column', minWidth: '100%' };
const LINE: ViewStyle = {
  flexDirection: 'row',
  minHeight: size.listRowCompact,
  borderBottomWidth: rule.hairline,
};
const CELL: ViewStyle = { justifyContent: 'center', paddingHorizontal: space.x2 };
// A column with no width of its own shares the room the others leave, and is never narrower than
// two targets and the room between them. The width is what the row is measured with before the
// room is shared, so a cell's own content never widens the table.
const NARROWEST = size.target * 2 + space.x2;
const SHARED: ViewStyle = { flexGrow: 1, flexBasis: 0, width: NARROWEST, minWidth: NARROWEST };
// The first column stays while the others pass under it.
const HELD: ViewStyle = { zIndex: z.sticky };
// The row with focus stands over its neighbours, so its ring is not drawn under their first cells.
const RAISED: ViewStyle = { zIndex: z.sticky };
// The room the last row's focus ring takes under the table.
const RING_ROOM: ViewStyle = { paddingBottom: rule.focus + rule.focusGap };
const START: ViewStyle = { alignItems: 'flex-start' };
const END: ViewStyle = { alignItems: 'flex-end' };
// The bar of the row with keyboard focus: at the row's left edge, taking no room.
const FOCUS_BAR: ViewStyle = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  left: 0,
  width: rule.active,
};

function endAligned(column: Column): boolean {
  return column.numeric === true || column.align === 'end';
}

function boxOf(column: Column): ViewStyle {
  return {
    ...CELL,
    ...(column.width === undefined ? SHARED : { width: column.width }),
    ...(endAligned(column) ? END : START),
  };
}

/** A value as the table words it: "about" before an estimate, and null for one nobody knows. */
function wordsOf(value: DisplayValue, about: (value: string) => string): string | null {
  return value.text === null ? null : value.about ? about(value.text) : value.text;
}

/**
 * C-Table: results history and every admin table. Mono column heads over a rule, rows on soft
 * rules, numbers right-aligned in fixed-width digits, and the unknown tag where a value is not
 * known. When the columns do not fit, the table scrolls sideways inside its own box and its
 * first column stays. A row that opens something is one target; Up and Down move focus between
 * such rows, and the focused row shows a bar at its left edge.
 */
export function Table({ columns, rows, caption, empty, testID }: TableProps): JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation('common');
  const targets = useRef(new Map<string, ViewInstance>());
  const [focusedRow, setFocusedRow] = useState<string | null>(null);

  // The sideways offset moves the first column back by as much, on the UI thread (DS-motion).
  const offset = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler(
    (event) => {
      'worklet';
      offset.value = event.contentOffset.x;
    },
    [offset],
  );
  const hold = (): ViewStyle => {
    'worklet';
    return { transform: [{ translateX: offset.value }] };
  };
  // The worklets plugin lists what a worklet reads; without it the array is how the library knows.
  const held = useAnimatedStyle(hold, isWorkletFunction(hold) ? undefined : [offset]);

  const about = (value: string): string => t('aboutValue', { value });
  const opens = rows.filter((row) => row.onPress !== undefined || row.href !== undefined);

  /** Up and Down move focus to the next or the previous row that opens something. */
  const onRowKeyDown = (rowId: string, event: KeyDownEvent): void => {
    const { key, altKey, ctrlKey, metaKey } = event.nativeEvent;
    if (altKey || ctrlKey || metaKey || (key !== 'ArrowDown' && key !== 'ArrowUp')) {
      return;
    }
    // The key moves the focus, not the page.
    event.preventDefault();
    const index = opens.findIndex((row) => row.id === rowId);
    const next = opens[key === 'ArrowDown' ? index + 1 : index - 1];
    if (index === -1 || next === undefined) {
      return;
    }
    targets.current.get(next.id)?.focus();
  };

  /** The cells of one line; `ground` is what the first column hides the others with. */
  const cellsOf = (
    draw: (column: Column) => ReactNode,
    ground: string,
    role: 'cell' | 'columnheader' | null,
    bar: boolean,
  ): ReactNode =>
    columns.map((column, index) => {
      const content = draw(column);
      if (index > 0) {
        return (
          <View key={column.id} role={role ?? undefined} style={boxOf(column)}>
            {content}
          </View>
        );
      }
      return (
        <Animated.View
          key={column.id}
          role={role ?? undefined}
          style={[boxOf(column), HELD, { backgroundColor: ground }, held]}
        >
          {bar ? <View style={[FOCUS_BAR, { backgroundColor: theme.color.text }]} /> : null}
          {content}
        </Animated.View>
      );
    });

  // A column head wraps in a narrow column: it is never cut.
  const headOf = (column: Column): ReactNode => (
    <Text role="monoLabel" align={endAligned(column) ? 'end' : 'start'}>
      {column.header}
    </Text>
  );

  const valueOf = (row: Row, column: Column): ReactNode => {
    const cell = row.cells[column.id];
    if (isValidElement(cell)) {
      return cell;
    }
    // A cell the row does not give is a value nobody knows.
    const words = cell === undefined ? null : wordsOf(cell, about);
    return words === null ? (
      <Tag variant="unknown" />
    ) : (
      <Text
        role="body"
        numberOfLines={1}
        tabular={column.numeric === true}
        align={endAligned(column) ? 'end' : 'start'}
      >
        {words}
      </Text>
    );
  };

  /** The words of a row's first cell, which name the row; empty where that cell is an element. */
  const nameOf = (row: Row): string => {
    const first = columns[0];
    const cell = first === undefined ? undefined : row.cells[first.id];
    if (isValidElement(cell)) {
      return '';
    }
    return (cell === undefined ? null : wordsOf(cell, about)) ?? t('notKnownYet');
  };

  const soft = { borderBottomColor: theme.color.ruleSoft };

  return (
    <View role="table" aria-label={caption} testID={testID}>
      <Animated.ScrollView
        horizontal={true}
        onScroll={onScroll}
        contentContainerStyle={opens.length === 0 ? CONTENT : [CONTENT, RING_ROOM]}
      >
        <View role="row" style={[LINE, { borderBottomColor: theme.color.rule }]}>
          {cellsOf(headOf, theme.color.bg, 'columnheader', false)}
        </View>
        {rows.length === 0 ? null : (
          <View role="rowgroup">
            {rows.map((row) => {
              const rowId = `${testID}-${row.id}`;
              if (row.onPress === undefined && row.href === undefined) {
                return (
                  <View key={row.id} role="row" style={[LINE, soft]} testID={rowId}>
                    {cellsOf((column) => valueOf(row, column), theme.color.bg, 'cell', false)}
                  </View>
                );
              }
              // A row that opens something is one target inside one cell as wide as the table.
              const span: WebSpanProps = { 'aria-colspan': columns.length };
              return (
                <View
                  key={row.id}
                  role="row"
                  style={focusedRow === row.id ? RAISED : null}
                  onFocus={() => {
                    setFocusedRow(row.id);
                  }}
                  onBlur={() => {
                    setFocusedRow((current) => (current === row.id ? null : current));
                  }}
                  onKeyDown={(event) => {
                    onRowKeyDown(row.id, event);
                  }}
                >
                  <View role="cell" {...span}>
                    <Pressable
                      ref={(target) => {
                        if (target === null) {
                          targets.current.delete(row.id);
                        } else {
                          targets.current.set(row.id, target);
                        }
                      }}
                      role={row.href === undefined ? 'button' : 'link'}
                      {...(row.href === undefined ? {} : { href: row.href })}
                      {...(row.onPress === undefined ? {} : { onPress: row.onPress })}
                      label={nameOf(row)}
                      hover="fill"
                      feedback="fill"
                      radius={radius.none}
                      testID={rowId}
                    >
                      {({ hovered, pressed, focused }) => (
                        <View style={[LINE, soft]}>
                          {cellsOf(
                            (column) => valueOf(row, column),
                            hovered || pressed ? theme.color.hoverBg : theme.color.bg,
                            null,
                            focused,
                          )}
                        </View>
                      )}
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </Animated.ScrollView>
      {rows.length === 0 && empty !== undefined ? empty : null}
    </View>
  );
}
