import { assertNever } from '@citizenrun/shared';
import { FlashList } from '@shopify/flash-list';
import type { FlashListRef, ViewToken } from '@shopify/flash-list';
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, ReactElement, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent, ViewStyle } from 'react-native';

import { video } from '@/platform/video';
import { focusRingStyle } from '@/ui/focus';
import { useReducedMotion } from '@/ui/motion';
import { useShell } from '@/ui/shells/app-shell';
import { useOnReselect } from '@/ui/shells/reselect';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { radius, rule, space } from '@/ui/tokens';

import { FeedRule } from './feed-rule';
import { Notice } from './notice';
import { Rule } from './rule';
import { Skeleton } from './skeleton';

/** An item's video: its media key and its playable URL. */
type Clip = { key: string; url: string };

export type ListProps<T> = {
  items: readonly T[];
  renderItem: (item: T, index: number) => ReactElement;
  keyOf: (item: T) => string;
  /** The kind of cell an item needs: a cell is reused only for an item of its own kind. */
  typeOf?: (item: T) => string;
  /** Default 1. */
  columns?: 1 | 2 | 3;
  /** Not read yet. */
  spanOf?: (item: T, index: number) => 1 | 2 | 3;
  /** Above the first item. */
  header?: ReactElement | null;
  /** Default 'none'. 'soft': a soft rule between rows. 'dotted': the feed's rule between cards. */
  separator?: 'none' | 'soft' | 'dotted';
  /** Drawn in place of the list when it is ready with no items: a C-EmptyState. */
  empty?: ReactElement;
  status: 'loading' | 'ready' | 'loadingMore' | 'moreFailed' | 'end';
  /** Default 'row': the shape of the skeletons that stand in for items. */
  loadingShape?: 'card' | 'row' | 'cell';
  /** Drawn after the last item at 'end'. */
  end?: ReactElement | null;
  /** Called at the end of the list, and only while the status is 'ready'. */
  onEndReached?: () => void;
  onRetryMore?: () => void;
  /** Not read yet. */
  onRefresh?: () => void; // C-PullToRefresh
  /** Not read yet. */
  refreshing?: boolean; // C-PullToRefresh
  /** The list keeps its scroll offset under this key and takes it back when it mounts again. */
  restoreKey?: string;
  onVisibleChange?: (visibleKeys: readonly string[]) => void;
  /** Not read yet. */
  onAtTopChange?: (atTop: boolean) => void;
  /** Not read yet. */
  scrollToTopRequest?: number;
  /** Not read yet. */
  anchor?: 'top' | 'bottom';
  /** Not read yet. */
  scrollToEndRequest?: number;
  /** Not read yet. */
  keyboardItems?: boolean; // DS-shortcuts
  /** Not read yet. */
  keyboardActive?: boolean;
  /** An item's video, for the one-player rule and the preload; null for an item with none. */
  videoOf?: (item: T) => Clip | null;
  testID: string;
};

type Status = ListProps<unknown>['status'];
type LoadingShape = NonNullable<ListProps<unknown>['loadingShape']>;

/** How long after the last scroll event a list counts as settled where no momentum end arrives. */
const SCROLL_SETTLE_MS = 250; // PM-video

const VIEWABILITY = { itemVisiblePercentThreshold: video.visibleThreshold };

const LOADING_COUNT = 3;
const LOADING_MORE_COUNT = 2;

// The list fills its parent, which gives it a height.
const ROOT: ViewStyle = { flex: 1 };
const CLIPPED: ViewStyle = { flex: 1, overflow: 'hidden' };
const GRID: ViewStyle = { flexDirection: 'row', flexWrap: 'wrap' };
const BETWEEN_CARDS: ViewStyle = { gap: space.x6 };
const GRID_CELL: ViewStyle = { padding: space.pip };
/** The share of a row one item takes, by the number of columns. */
const COLUMN_SHARE = { 1: '100%', 2: '50%', 3: '33.333%' } as const;
const FAILED: ViewStyle = { paddingVertical: space.x3 };
/**
 * The scroll element fills the box that clips it, so its focus ring is drawn inside its edge, with the
 * ring's gap between the two.
 */
const RING_INSET = -(rule.focus + rule.focusGap);

/** MO-tab-restore: the scroll offset of each list that asked for one, kept while the app runs. */
const offsets = new Map<string, number>();

export function rememberOffset(key: string, offset: number): void {
  offsets.set(key, offset);
}

export function recallOffset(key: string): number | null {
  return offsets.get(key) ?? null;
}

/** D-178: a list asks for its next page only while it is ready. */
export function canLoadMore(status: Status): boolean {
  return status === 'ready';
}

/**
 * PM-video, the list's rule: the first item in view that has a video is the one that plays, and the
 * next item after it that has one is loaded ahead.
 */
export function pickVideoTargets<T>(
  viewable: readonly T[],
  all: readonly T[],
  videoOf: (item: T) => Clip | null,
): { activeKey: string | null; preload: Clip | null } {
  const inView = new Set<string>();
  for (const item of viewable) {
    const clip = videoOf(item);
    if (clip !== null) inView.add(clip.key);
  }
  let activeKey: string | null = null;
  if (inView.size === 0) {
    return { activeKey, preload: null };
  }
  for (const item of all) {
    const clip = videoOf(item);
    if (clip === null) continue;
    if (activeKey !== null) {
      return { activeKey, preload: clip };
    }
    if (inView.has(clip.key)) activeKey = clip.key;
  }
  return { activeKey, preload: null };
}

const ActiveVideoContext = createContext<string | null>(null);

/** True for the one video cell this list has made active. Read by C-VideoPlayer's caller. */
export function useIsActiveVideo(videoKey: string): boolean {
  return useContext(ActiveVideoContext) === videoKey;
}

type VideoActivation<T> = {
  activeKey: string | null;
  /** The items in view changed. */
  see: (viewable: readonly T[]) => void;
  /** The list moved. */
  moved: () => void;
  /** The list came to rest. */
  settle: () => void;
};

/** PM-video: tracks the items in view and, each time the list settles, picks the video that plays. */
function useVideoActivation<T>(
  items: readonly T[],
  videoOf: ListProps<T>['videoOf'],
): VideoActivation<T> {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const latest = useRef({ items, videoOf });
  const inView = useRef<readonly T[]>([]);
  const preloaded = useRef<Clip | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latest.current = { items, videoOf };
  }, [items, videoOf]);

  const settle = (): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const { items: all, videoOf: clipOf } = latest.current;
    // Without `videoOf` the list never reaches the video module.
    if (clipOf === undefined) return;
    const targets = pickVideoTargets(inView.current, all, clipOf);
    setActiveKey(targets.activeKey);
    const previous = preloaded.current;
    if (previous?.key === targets.preload?.key) return;
    if (previous !== null && previous.key !== targets.activeKey) {
      video.controller.cancelPreload(previous.key);
    }
    if (targets.preload !== null) {
      video.controller.preload(targets.preload.key, {
        uri: targets.preload.url,
        cacheKey: targets.preload.key,
      });
    }
    preloaded.current = targets.preload;
  };

  const moved = (): void => {
    if (latest.current.videoOf === undefined) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(settle, SCROLL_SETTLE_MS);
  };

  const see = (viewable: readonly T[]): void => {
    inView.current = viewable;
    // A list that has not been scrolled settles too, so a video in its first view plays.
    moved();
  };

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      const waiting = preloaded.current;
      preloaded.current = null;
      // Only a list with `videoOf` ever preloaded a clip.
      if (waiting !== null) video.controller.cancelPreload(waiting.key);
    },
    [],
  );

  return { activeKey, see, moved, settle };
}

/** An element whose attributes and focus can be reached from code: the web's is one, a phone's view is not. */
type FocusHost = {
  setAttribute: (name: string, value: string) => void;
  addEventListener: (type: 'focus' | 'blur', listener: () => void) => void;
  removeEventListener: (type: 'focus' | 'blur', listener: () => void) => void;
};

function isFocusHost(host: unknown): host is FocusHost {
  return (
    typeof host === 'object' &&
    host !== null &&
    'setAttribute' in host &&
    typeof host.setAttribute === 'function' &&
    'addEventListener' in host &&
    typeof host.addEventListener === 'function' &&
    'removeEventListener' in host &&
    typeof host.removeEventListener === 'function'
  );
}

/**
 * The keyboard reaches a list on the web as it reaches any scrolling region: its scroll element is a
 * Tab stop, a named group, whose arrow and page keys scroll it, with the focus ring while it has
 * focus. A list whose rows hold no control could not be scrolled from the keyboard otherwise. A
 * phone's scroll view has no attributes and is left as it is. True while the element has focus.
 */
function useKeyboardScroll<T>(
  listRef: RefObject<FlashListRef<T> | null>,
  drawn: boolean,
  label: string,
): boolean {
  const [focused, setFocused] = useState(false);
  useLayoutEffect(() => {
    if (!drawn) return undefined;
    const host: unknown = listRef.current?.getScrollableNode();
    if (!isFocusHost(host)) return undefined;
    host.setAttribute('tabindex', '0');
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', label);
    const focus = (): void => {
      setFocused(true);
    };
    const blur = (): void => {
      setFocused(false);
    };
    host.addEventListener('focus', focus);
    host.addEventListener('blur', blur);
    return () => {
      host.removeEventListener('focus', focus);
      host.removeEventListener('blur', blur);
      setFocused(false);
    };
  }, [listRef, drawn, label]);
  return focused;
}

function SoftSeparator(): JSX.Element {
  return <Rule variant="soft" inset="gutter" />;
}

function DottedSeparator(): JSX.Element {
  return <FeedRule />;
}

function separatorOf(
  separator: NonNullable<ListProps<unknown>['separator']>,
): (() => JSX.Element) | null {
  switch (separator) {
    case 'none':
      return null;
    case 'soft':
      return SoftSeparator;
    case 'dotted':
      return DottedSeparator;
    default:
      return assertNever(separator);
  }
}

/** Skeletons in the place of items: in the list's columns, and at the gutter where rows are. */
function Skeletons({
  shape,
  count,
  columns,
}: {
  shape: LoadingShape;
  count: number;
  columns: 1 | 2 | 3;
}): JSX.Element {
  const layout = useBreakpoint();
  const cells = Array.from({ length: count }, (_, index) => index);
  return (
    <View
      style={[
        columns > 1 ? GRID : shape === 'card' ? BETWEEN_CARDS : null,
        // A grid cell reaches the edges; a row and a card keep the gutter their words keep.
        shape === 'cell' ? null : { paddingHorizontal: layout.gutter },
      ]}
    >
      {cells.map((cell) => (
        <View
          key={cell}
          style={[{ width: COLUMN_SHARE[columns] }, shape === 'cell' ? GRID_CELL : null]}
        >
          <Skeleton shape={shape} />
        </View>
      ))}
    </View>
  );
}

/**
 * C-List: every long list, over FlashList (D-034) with D-178's rules: no size estimate, no key
 * inside a cell, and a next page asked for only while ready. It draws its own loading, more,
 * failed, end and empty states, keeps its scroll offset under `restoreKey`, goes back to its top
 * when its tab is chosen again, and with `videoOf` makes one video cell at a time the active one.
 */
export function List<T>({
  items,
  renderItem,
  keyOf,
  typeOf,
  columns = 1,
  header,
  separator = 'none',
  empty,
  status,
  loadingShape = 'row',
  end,
  onEndReached,
  onRetryMore,
  restoreKey,
  onVisibleChange,
  videoOf,
  testID,
}: ListProps<T>): JSX.Element {
  const layout = useBreakpoint();
  const shell = useShell();
  const theme = useTheme();
  const { t } = useTranslation(['common', 'errors']);
  const reducedMotion = useReducedMotion();
  const listRef = useRef<FlashListRef<T>>(null);
  // MO-tab-restore: the tab this list belongs to is the one that was active when it first drew.
  const [tab] = useState(shell.active);
  // The offset to take back, until the list has been laid out with its items.
  const restore = useRef(restoreKey === undefined ? null : recallOffset(restoreKey));
  const activation = useVideoActivation(items, videoOf);
  const drawn = status !== 'loading' && !(status === 'ready' && items.length === 0);
  const focused = useKeyboardScroll(listRef, drawn, t('ui.list.label'));

  useOnReselect(tab, () => {
    listRef.current?.scrollToOffset({ offset: 0, animated: !reducedMotion });
  });

  if (status === 'loading') {
    return (
      <View style={CLIPPED} testID={testID}>
        <Skeletons shape={loadingShape} count={LOADING_COUNT} columns={columns} />
      </View>
    );
  }
  if (status === 'ready' && items.length === 0) {
    return (
      <View style={ROOT} testID={testID}>
        {empty}
      </View>
    );
  }

  const footer = (): ReactElement | null => {
    switch (status) {
      case 'ready':
        return null;
      case 'loadingMore':
        return <Skeletons shape={loadingShape} count={LOADING_MORE_COUNT} columns={columns} />;
      case 'moreFailed':
        return (
          <View style={[FAILED, { paddingHorizontal: layout.gutter }]}>
            <Notice
              kind="error"
              text={t('errors:generic')}
              {...(onRetryMore === undefined
                ? {}
                : {
                    action: {
                      label: t('ui.retry'),
                      onPress: onRetryMore,
                      testID: `${testID}-retry-more`,
                    },
                  })}
            />
          </View>
        );
      case 'end':
        return end ?? null;
      default:
        return assertNever(status);
    }
  };

  const watchesItems = onVisibleChange !== undefined || videoOf !== undefined;

  return (
    <View style={ROOT} testID={testID}>
      <ActiveVideoContext.Provider value={activation.activeKey}>
        <FlashList
          ref={listRef}
          data={items}
          renderItem={({ item, index }) => renderItem(item, index)}
          keyExtractor={keyOf}
          {...(typeOf === undefined ? {} : { getItemType: typeOf })}
          numColumns={columns}
          ListHeaderComponent={header}
          ListFooterComponent={footer()}
          ItemSeparatorComponent={separatorOf(separator)}
          onEndReached={() => {
            if (canLoadMore(status)) onEndReached?.();
          }}
          viewabilityConfig={VIEWABILITY}
          onViewableItemsChanged={
            watchesItems
              ? ({ viewableItems }: { viewableItems: ViewToken<T>[] }) => {
                  const viewable = viewableItems.map((token) => token.item);
                  activation.see(viewable);
                  onVisibleChange?.(viewable.map(keyOf));
                }
              : null
          }
          scrollEventThrottle={16}
          onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
            if (restoreKey !== undefined) {
              rememberOffset(restoreKey, event.nativeEvent.contentOffset.y);
            }
            activation.moved();
          }}
          onMomentumScrollEnd={activation.settle}
          {...(focused
            ? {
                overrideProps: {
                  style: { ...focusRingStyle(theme, radius.none), outlineOffset: RING_INSET },
                },
              }
            : {})}
          onCommitLayoutEffect={() => {
            // Before the first paint of the items, so the list opens where it was left.
            const offset = restore.current;
            if (offset === null) return;
            restore.current = null;
            if (offset > 0) listRef.current?.scrollToOffset({ offset, animated: false });
          }}
        />
      </ActiveVideoContext.Provider>
    </View>
  );
}
