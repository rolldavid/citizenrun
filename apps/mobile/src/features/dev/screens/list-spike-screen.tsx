import { memo, useMemo } from 'react';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { head } from '@/platform/head';
import { List } from '@/ui/components/list';
import { Screen } from '@/ui/components/screen';
import { Text } from '@/ui/components/text';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { size, space } from '@/ui/tokens';

import { LIST_SPIKE_COUNT, listSpikeCount, listSpikeItems } from './list-spike-items';
import type { ListSpikeItem } from './list-spike-items';

// The list needs a bounded height to recycle its rows: without it a web list draws every row.
const LIST_BOX: ViewStyle = { flex: 1 };
const HEADER: ViewStyle = { paddingVertical: space.x4, gap: space.x1 };
const TEXT_ROW: ViewStyle = { minHeight: size.listRowMin, paddingVertical: space.x3 };
const BLOCK_ROW: ViewStyle = { paddingVertical: space.x4, gap: space.x2 };
const COMPACT_ROW: ViewStyle = { paddingVertical: space.x2 };
const BLOCK: ViewStyle = { width: '100%', maxWidth: size.feedColumn, aspectRatio: 4 / 5 };

const keyOf = (item: ListSpikeItem): string => item.key;
const typeOf = (item: ListSpikeItem): string => item.kind;
const renderItem = (item: ListSpikeItem): JSX.Element => <ListSpikeRow item={item} />;

/** One row of the spike, in one of three heights; no state and no key inside the cell (D-178). */
const ListSpikeRow = memo(function ListSpikeRow({ item }: { item: ListSpikeItem }): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const position = String(item.index + 1);
  const sides: ViewStyle = { paddingHorizontal: layout.gutter };
  const testID = `dev.list-spike-row-${String(item.index)}`;
  switch (item.kind) {
    case 'text':
      return (
        <View testID={testID} style={[TEXT_ROW, sides]}>
          <Text role="label">{`Row ${position}`}</Text>
          <Text role="caption" tone="secondary">
            A text row with two lines
          </Text>
        </View>
      );
    case 'block':
      return (
        <View testID={testID} style={[BLOCK_ROW, sides]}>
          <View style={[BLOCK, { backgroundColor: theme.color.well }]} />
          <Text role="caption">{`Block row ${position}`}</Text>
        </View>
      );
    case 'compact':
      return (
        <View testID={testID} style={[COMPACT_ROW, sides]}>
          <Text role="body">{`Compact row ${position}`}</Text>
        </View>
      );
  }
});

export type ListSpikeScreenProps = {
  /** The `rows` route parameter, or null when the address has none: 1,000 rows unless it asks for fewer. */
  rows: string | null;
};

/** SCR-dev-spikes: the list spike (D-100 row 8), 1,000 rows of three kinds through C-List. */
export function ListSpikeScreen({ rows }: ListSpikeScreenProps): JSX.Element {
  const count = listSpikeCount(rows);
  // Made once per count, so the list's data keeps its identity between renders.
  const items = useMemo(() => listSpikeItems(count), [count]);
  const caption =
    count === LIST_SPIKE_COUNT
      ? '1,000 rows of three kinds through C-List'
      : `${String(count)} rows of three kinds through C-List`;
  return (
    <Screen width="full" scroll={false} appBar={null} testID="dev.list-spike">
      <head.Title>List spike</head.Title>
      <View style={HEADER}>
        <Text role="heading" heading={1}>
          List spike
        </Text>
        <Text role="caption" tone="secondary">
          {caption}
        </Text>
      </View>
      <View style={LIST_BOX}>
        <List
          items={items}
          keyOf={keyOf}
          typeOf={typeOf}
          renderItem={renderItem}
          status="ready"
          separator="soft"
          testID="dev.list-spike-list"
        />
      </View>
    </Screen>
  );
}
