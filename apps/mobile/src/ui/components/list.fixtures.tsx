import type { JSX } from 'react';
import { View } from 'react-native';

import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { size, space } from '@/ui/tokens';
import type { ColorToken } from '@/ui/tokens';

import { EmptyState } from './empty-state';
import type { ListProps } from './list';
import type { InteractionPreviewState } from './pressable';
import { Text } from './text';

/** One row of the specimen lists. */
type ListFixtureItem = { id: string; name: string };

const OFFICES = [
  'County Clerk',
  'County Sheriff',
  'County Assessor',
  'County Treasurer',
  'County Commissioner, District 1',
  'County Commissioner, District 2',
  'County Commissioner, District 3',
  'Alder City Council, Ward 1',
  'Alder City Council, Ward 2',
  'Alder School Board, Seat 3',
  'Wren County Water District Board',
  'Wren County Library Board',
] as const;

const ROWS: readonly ListFixtureItem[] = OFFICES.map((name, index) => ({
  id: `office-${String(index + 1)}`,
  name,
}));

/** A row keeps the screen's gutter, as the rule between rows does. */
function Row({ name }: { name: string }): JSX.Element {
  const { gutter } = useBreakpoint();
  return (
    <View
      style={{ minHeight: size.listRowMin, justifyContent: 'center', paddingHorizontal: gutter }}
    >
      <Text role="body">{name}</Text>
    </View>
  );
}

function row(item: ListFixtureItem): JSX.Element {
  return <Row name={item.name} />;
}

/** The line after the last row. */
function End(): JSX.Element {
  const { gutter } = useBreakpoint();
  return (
    <View style={{ paddingHorizontal: gutter, paddingVertical: space.x4 }}>
      <Text role="caption" tone="secondary">
        That is every office in Wren County.
      </Text>
    </View>
  );
}

/** What stands in the list's place when it has no rows. */
function Empty(): JSX.Element {
  const { gutter } = useBreakpoint();
  return (
    <View style={{ paddingHorizontal: gutter }}>
      <EmptyState
        art="none"
        title="No offices here yet."
        body="Offices are added as each county publishes its filing calendar."
      />
    </View>
  );
}

const BASE = {
  items: ROWS,
  renderItem: row,
  keyOf: (item: ListFixtureItem) => item.id,
} as const;

export const STATES = {
  loading: {
    ...BASE,
    items: [],
    status: 'loading',
    loadingShape: 'card',
    testID: 'gallery.list-loading',
  },
  loadingRows: { ...BASE, items: [], status: 'loading', testID: 'gallery.list-loading-rows' },
  ready: { ...BASE, status: 'ready', separator: 'soft', testID: 'gallery.list-ready' },
  loadingMore: {
    ...BASE,
    status: 'loadingMore',
    separator: 'soft',
    testID: 'gallery.list-loading-more',
  },
  moreFailed: {
    ...BASE,
    status: 'moreFailed',
    separator: 'soft',
    onRetryMore: () => undefined,
    testID: 'gallery.list-more-failed',
  },
  end: {
    ...BASE,
    status: 'end',
    separator: 'soft',
    end: <End />,
    testID: 'gallery.list-end',
  },
  empty: {
    ...BASE,
    items: [],
    status: 'ready',
    empty: <Empty />,
    testID: 'gallery.list-empty',
  },
  dotted: { ...BASE, status: 'ready', separator: 'dotted', testID: 'gallery.list-dotted' },
} as const satisfies Readonly<Record<string, ListProps<ListFixtureItem>>>;

export const PREVIEW: Readonly<Partial<Record<keyof typeof STATES, InteractionPreviewState>>> = {};

export const GROUND: Readonly<Partial<Record<keyof typeof STATES, ColorToken>>> = {};
