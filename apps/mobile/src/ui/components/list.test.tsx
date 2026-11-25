import type * as FlashListModule from '@shopify/flash-list';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { createElement, useImperativeHandle, useLayoutEffect } from 'react';
import type { JSX, ReactElement, Ref } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { video } from '@/platform/video';
import { videoFake } from '@/test/platform/video';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { ShellLayout } from '@/ui/shells/app-shell';
import { STATES as SHELL_STATES } from '@/ui/shells/app-shell.fixtures';
import { emitReselect } from '@/ui/shells/reselect';
import { color, gutter, rule, size, space } from '@/ui/tokens';

import {
  List,
  canLoadMore,
  pickVideoTargets,
  recallOffset,
  rememberOffset,
  useIsActiveVideo,
} from './list';
import type { ListProps } from './list';
import { GROUND, PREVIEW, STATES } from './list.fixtures';
import { InteractionPreview } from './pressable';
import { Text } from './text';

type FlashListProps<T> = FlashListModule.FlashListProps<T>;
type ViewToken<T> = FlashListModule.ViewToken<T>;

/** What the list under test hands the list library, and the one method of it the list calls. */
const flash = vi.hoisted(() => ({
  /** True: a stand-in that draws every item takes the library's place. */
  standIn: false,
  props: [] as unknown[],
  scrollToOffset: vi.fn(),
}));

// jsdom lays nothing out, so the library draws a header and a footer and no item there. The cases
// that read what the list hands the library, or need its items drawn, switch a stand-in on.
vi.mock('@shopify/flash-list', async (importOriginal) => {
  const actual = await importOriginal<typeof FlashListModule>();
  type Handle = FlashListModule.FlashListRef<unknown>;
  type Handed = FlashListProps<unknown> & { ref?: Ref<Handle> };
  function StandIn(props: Handed): ReactElement {
    const {
      ref,
      data,
      renderItem,
      keyExtractor,
      ItemSeparatorComponent: Separator,
      ListHeaderComponent: header,
      ListFooterComponent: footer,
      onCommitLayoutEffect,
    } = props;
    // The list calls these two methods of the library's list. The stand-in draws no scroll element.
    useImperativeHandle(
      ref,
      () =>
        ({
          scrollToOffset: flash.scrollToOffset,
          getScrollableNode: () => null,
        }) as unknown as Handle, // two methods stand in
      [],
    );
    // The library tells the list when its items are laid out, before they are painted.
    useLayoutEffect(() => {
      flash.props.push(props);
      onCommitLayoutEffect?.();
    });
    const items = data ?? [];
    return createElement(
      'div',
      { 'data-stand-in': 'list' },
      header as ReactElement | null, // the list under test hands an element
      items.map((item, index) =>
        createElement(
          'div',
          { key: keyExtractor?.(item, index) ?? String(index), 'data-cell': index },
          renderItem?.({ item, index, target: 'Cell' }),
          Separator !== null && Separator !== undefined && index < items.length - 1
            ? createElement(Separator)
            : null,
        ),
      ),
      footer as ReactElement | null, // the list under test hands an element
    );
  }
  return {
    ...actual,
    FlashList: (props: Handed): ReactElement =>
      flash.standIn ? createElement(StandIn, props) : createElement(actual.FlashList, props),
  };
});

// react-native-safe-area-context 5.11.1 names its CommonJS build as `main`. The test resolver picks
// that build, and it loads the phone's React Native; the module build is the one that runs on the web:
// https://github.com/AppAndFlow/react-native-safe-area-context/blob/v5.11.1/package.json
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);
// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// An interface icon loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('an interface icon loads no asset');
  },
}));

type StateName = keyof typeof STATES;
type Row = (typeof STATES)['ready']['items'][number];

const STATE_NAMES = [
  'loading',
  'loadingRows',
  'ready',
  'loadingMore',
  'moreFailed',
  'end',
  'empty',
  'dotted',
] as const;

const NARROW = [360, 740] as const;
const COMPACT = [390, 844] as const;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const END = 'That is every office in Wren County.';
// A page that failed has no error code: the notice blames no side.
const FAILED = 'Something went wrong. Try again.';

/** An item of the video cases: `d` and `b` have a video. */
type Clip = { id: string; video: string | null };

const A: Clip = { id: 'a', video: null };
const B: Clip = { id: 'b', video: 'https://media.example/b.mp4' };
const C: Clip = { id: 'c', video: null };
const D: Clip = { id: 'd', video: 'https://media.example/d.mp4' };
const CLIPS = [A, B, C, D] as const;

function videoOf(item: Clip): { key: string; url: string } | null {
  return item.video === null ? null : { key: `video-${item.id}`, url: item.video };
}

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one element, in place of whatever was drawn before. */
function draw(element: ReactElement, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  flash.props = [];
  flash.scrollToOffset.mockClear();
  return renderWithProviders(element, options).container;
}

function drawState(state: StateName, options: RenderWithProvidersOptions = {}): HTMLElement {
  draw(<List<Row> {...STATES[state]} />, options);
  return screen.getByTestId(STATES[state].testID);
}

/** What the list handed the library at its latest render. */
function handed<T>(): FlashListProps<T> {
  const latest = flash.props.at(-1);
  if (latest === undefined) {
    throw new Error('the list drew no library list');
  }
  return latest as FlashListProps<T>; // recorded by the stand-in from the list under test
}

/** A view token of the library for one item. */
function token<T>(item: T, index: number): ViewToken<T> {
  return { item, index, key: String(index), isViewable: true, timestamp: 0 };
}

function see<T>(items: readonly T[], all: readonly T[]): void {
  act(() => {
    handed<T>().onViewableItemsChanged?.({
      viewableItems: items.map((item) => token(item, all.indexOf(item))),
      changed: [],
    });
  });
}

function scrollTo(offset: number): void {
  const event = { nativeEvent: { contentOffset: { x: 0, y: offset } } };
  act(() => {
    // The list reads the offset alone.
    handed().onScroll?.(event as NativeSyntheticEvent<NativeScrollEvent>);
  });
}

/** A cell that writes out whether its video is the active one. */
function Playing({ id }: { id: string }): JSX.Element {
  return (
    <Text role="body" testID={`probe.playing-${id}`}>
      {String(useIsActiveVideo(`video-${id}`))}
    </Text>
  );
}

function playing(id: string): string | null {
  return screen.getByTestId(`probe.playing-${id}`).textContent;
}

/** A list of the four clips, each cell saying whether it plays. */
function clipList(more: Partial<ListProps<Clip>> = {}): JSX.Element {
  return (
    <List<Clip>
      items={CLIPS}
      renderItem={(item) => <Playing id={item.id} />}
      keyOf={(item) => item.id}
      status="ready"
      testID="probe.list"
      {...more}
    />
  );
}

afterEach(() => {
  flash.standIn = false;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('List', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const viewport of [NARROW, COMPACT]) {
      setViewport(viewport[0], viewport[1]);
      for (const theme of ['light', 'dark'] as const) {
        for (const state of STATE_NAMES) {
          cleanup();
          renderWithProviders(
            <InteractionPreview state={PREVIEW[state] ?? {}}>
              <List<Row> {...STATES[state]} />
            </InteractionPreview>,
            { theme },
          );
          // The list fills its parent, which gives it a height.
          const root = screen.getByTestId(STATES[state].testID);
          expect(root.style.flexGrow, state).toBe('1');
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the eight states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.loading.loadingShape).toBe('card');
    expect('loadingShape' in STATES.loadingRows).toBe(false);
    expect(STATES.ready.items).toHaveLength(12);
    expect(STATES.ready.separator).toBe('soft');
    expect(STATES.dotted.separator).toBe('dotted');
    expect(STATES.empty.items).toHaveLength(0);
    expect(STATES.empty.status).toBe('ready');
    for (const state of STATE_NAMES) {
      expect(STATES[state].testID, state).toMatch(TEST_ID);
    }
    // Each row has a key of its own.
    expect(new Set(STATES.ready.items.map(STATES.ready.keyOf)).size).toBe(12);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('loading draws three skeletons and nothing else', () => {
    setViewport(...COMPACT);
    flash.standIn = true;
    const cards = drawState('loading');
    expect(within(cards).getAllByRole('progressbar')).toHaveLength(3);
    // The shape asked for: a card has a canvas.
    for (const skeleton of within(cards).getAllByRole('progressbar')) {
      expect(skeleton.innerHTML).toContain('aspect-ratio');
    }
    // Not the library's list, no footer, no words, no spinner.
    expect(flash.props).toHaveLength(0);
    expect(cards.textContent).toBe('');
    expect(cards.querySelectorAll('svg, img, [data-testid]')).toHaveLength(0);
    // The skeletons stand at the gutter and are cut at the list's own edge.
    expect(cards.style.overflow).toBe('hidden');
    const holder = cards.firstElementChild;
    expect(cards.children).toHaveLength(1);
    expect(holder instanceof HTMLElement ? holder.style.paddingLeft : null).toBe(
      `${String(gutter.regular)}px`,
    );
    expect(holder instanceof HTMLElement ? holder.style.gap : null).toBe(`${String(space.x6)}px`);

    // A row by default.
    const rows = drawState('loadingRows');
    expect(within(rows).getAllByRole('progressbar')).toHaveLength(3);
    for (const skeleton of within(rows).getAllByRole('progressbar')) {
      expect(skeleton.innerHTML).not.toContain('aspect-ratio');
      expect(skeleton.querySelector<HTMLElement>('[style*="min-height"]')?.style.minHeight).toBe(
        `${String(size.listRowMin)}px`,
      );
    }

    // Nothing else, whatever else the list was given.
    const full = draw(
      <List<Row>
        {...STATES.ready}
        status="loading"
        header={<Text role="body">Offices</Text>}
        end={<Text role="body">{END}</Text>}
      />,
    );
    expect(within(full).getAllByRole('progressbar')).toHaveLength(3);
    expect(full.textContent).toBe('');
    expect(flash.props).toHaveLength(0);
  });

  it('loading sets grid cells side by side in the columns of the list', () => {
    setViewport(...COMPACT);
    const root = draw(
      <List<Row> {...STATES.loading} loadingShape="cell" columns={3} testID="probe.list" />,
    );
    const skeletons = within(root).getAllByRole('progressbar');
    expect(skeletons).toHaveLength(3);
    const grid = skeletons[0]?.parentElement?.parentElement;
    expect(grid?.style.flexDirection).toBe('row');
    expect(grid?.style.flexWrap).toBe('wrap');
    // Edge to edge: a grid has no gutter.
    expect(grid?.style.paddingLeft).toBe('');
    for (const skeleton of skeletons) {
      expect(skeleton.parentElement?.style.width).toBe('33.333%');
      expect(skeleton.parentElement?.style.padding).toBe(`${String(space.pip)}px`);
    }
  });

  it('loadingMore draws two skeletons after the items', () => {
    setViewport(...COMPACT);
    // In the library's own list the footer is drawn where jsdom draws no item.
    const real = drawState('loadingMore');
    expect(within(real).getAllByRole('progressbar')).toHaveLength(2);

    flash.standIn = true;
    const root = drawState('loadingMore');
    const skeletons = within(root).getAllByRole('progressbar');
    expect(skeletons).toHaveLength(2);
    const cells = root.querySelectorAll('[data-cell]');
    expect(cells).toHaveLength(12);
    const last = cells[cells.length - 1];
    for (const skeleton of skeletons) {
      expect(
        (last?.compareDocumentPosition(skeleton) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // Rows, as the list's loading shape says.
      expect(skeleton.innerHTML).not.toContain('aspect-ratio');
    }
    // Never a spinner footer.
    expect(root.querySelectorAll('img, [role="img"]')).toHaveLength(0);
  });

  it('moreFailed draws an error notice whose retry calls onRetryMore', () => {
    setViewport(...COMPACT);
    const onRetryMore = vi.fn();
    const state = STATES.moreFailed;
    for (const standIn of [false, true]) {
      flash.standIn = standIn;
      onRetryMore.mockClear();
      const root = draw(<List<Row> {...state} onRetryMore={onRetryMore} />);
      const notice = within(root).getByRole('alert');
      expect(within(notice).getByText(FAILED).style.color).toBe(written(color.light.danger));
      const retry = within(notice).getByTestId(`${state.testID}-retry-more`);
      expect(retry.getAttribute('aria-label')).toBe('Try again');
      fireEvent.click(retry);
      expect(onRetryMore, String(standIn)).toHaveBeenCalledTimes(1);
      // At the gutter, with room above and below.
      expect(notice.parentElement?.style.paddingLeft).toBe(`${String(gutter.regular)}px`);
      expect(notice.parentElement?.style.paddingTop).toBe(`${String(space.x3)}px`);
    }
    // After the last item.
    const cells = screen.getByTestId(state.testID).querySelectorAll('[data-cell]');
    expect(
      (cells[cells.length - 1]?.compareDocumentPosition(screen.getByRole('alert')) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // With nothing to call, the notice has no button.
    const { onRetryMore: dropped, ...plain } = state;
    expect(typeof dropped).toBe('function');
    const root = draw(<List<Row> {...plain} />);
    expect(within(root).getByRole('alert').querySelectorAll('[data-testid]')).toHaveLength(0);
  });

  it('end draws the end element', () => {
    setViewport(...COMPACT);
    expect(within(drawState('end')).getByText(END)).toBeDefined();

    flash.standIn = true;
    const root = drawState('end');
    const cells = root.querySelectorAll('[data-cell]');
    expect(
      (cells[cells.length - 1]?.compareDocumentPosition(within(root).getByText(END)) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Only at the end: the same list still loading shows none.
    expect(within(draw(<List<Row> {...STATES.end} status="ready" />)).queryByText(END)).toBeNull();
    expect(
      within(draw(<List<Row> {...STATES.end} status="loadingMore" />)).queryByText(END),
    ).toBeNull();
    // An end with nothing to say draws nothing.
    const { end: dropped, ...silent } = STATES.end;
    expect(dropped).toBeDefined();
    draw(<List<Row> {...silent} />);
    expect(handed().ListFooterComponent).toBeNull();
  });

  it('ready with no items draws empty', () => {
    setViewport(...COMPACT);
    flash.standIn = true;
    const root = drawState('empty');
    expect(
      within(root).getByRole('heading', { level: 2, name: 'No offices here yet.' }),
    ).toBeDefined();
    // In place of the library's list.
    expect(flash.props).toHaveLength(0);
    expect(within(root).queryByRole('progressbar')).toBeNull();
    // With nothing to draw in its place, the list is its own empty box.
    const { empty: dropped, ...bare } = STATES.empty;
    expect(dropped).toBeDefined();
    expect(draw(<List<Row> {...bare} />).textContent).toBe('');
    expect(screen.getByTestId(STATES.empty.testID).children).toHaveLength(0);
    // A list that is still loading more, or has ended, with no items is not empty.
    draw(<List<Row> {...STATES.empty} status="end" />);
    expect(screen.queryByRole('heading')).toBeNull();
    expect(flash.props.length).toBeGreaterThan(0);
  });

  it('hands the library the items with their keys, types and columns, and no size estimate', () => {
    setViewport(...COMPACT);
    flash.standIn = true;
    const root = drawState('ready');
    const first = handed<Row>();
    expect(first.data).toBe(STATES.ready.items);
    expect(first.keyExtractor?.(STATES.ready.items[2] ?? { id: '', name: '' }, 2)).toBe('office-3');
    expect(first.numColumns).toBe(1);
    // D-178: the library measures; the list never guesses a size.
    expect(Object.keys(first).filter((name) => /estimated|drawDistance/i.test(name))).toEqual([]);
    expect('getItemType' in first).toBe(false);
    // Every row is drawn through the caller's function, in order.
    expect([...root.querySelectorAll('[data-cell]')].map((cell) => cell.textContent)).toEqual(
      STATES.ready.items.map((item) => item.name),
    );

    const renderItem = vi.fn((item: Row) => <Text role="body">{item.name}</Text>);
    draw(
      <List<Row>
        {...STATES.ready}
        renderItem={renderItem}
        columns={3}
        typeOf={(item) => (item.id === 'office-1' ? 'first' : 'rest')}
        header={<Text role="body">Offices</Text>}
      />,
    );
    const second = handed<Row>();
    expect(second.numColumns).toBe(3);
    expect(second.getItemType?.(STATES.ready.items[0] ?? { id: '', name: '' }, 0)).toBe('first');
    expect(second.getItemType?.(STATES.ready.items[1] ?? { id: '', name: '' }, 1)).toBe('rest');
    expect(renderItem).toHaveBeenCalledWith(STATES.ready.items[4], 4);
    // The header stands above the first item.
    const cells = screen.getByTestId(STATES.ready.testID).querySelectorAll('[data-cell]');
    expect(
      screen.getByText('Offices').compareDocumentPosition(cells[0] ?? document.body) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('draws a soft rule or the dotted rule between items, and nothing by default', () => {
    setViewport(...COMPACT);
    flash.standIn = true;
    const separatorsOf = (root: HTMLElement): Element[] =>
      [...root.querySelectorAll('[data-cell]')].flatMap((cell) =>
        [...cell.children].filter((child) => child.getAttribute('aria-hidden') === 'true'),
      );

    // Between items, so one fewer than the items.
    const soft = separatorsOf(drawState('ready'));
    expect(soft).toHaveLength(11);
    for (const line of soft) {
      const drawn = line instanceof HTMLElement ? line.style : null;
      expect(drawn?.height).toBe(`${String(rule.hairline)}px`);
      expect(drawn?.backgroundColor).toBe(written(color.light.ruleSoft));
      // Held in from each side by the gutter.
      expect(drawn?.marginLeft).toBe(`${String(gutter.regular)}px`);
    }
    const dotted = separatorsOf(drawState('dotted'));
    expect(dotted).toHaveLength(11);
    for (const line of dotted) {
      expect(line.querySelectorAll('svg line')).toHaveLength(1);
    }
    const { separator: dropped, ...plain } = STATES.ready;
    expect(dropped).toBe('soft');
    draw(<List<Row> {...plain} />);
    expect(handed().ItemSeparatorComponent).toBeNull();
    expect(separatorsOf(screen.getByTestId(STATES.ready.testID))).toHaveLength(0);
  });

  it('loads more only when ready', () => {
    expect(canLoadMore('ready')).toBe(true);
    for (const status of ['loading', 'loadingMore', 'moreFailed', 'end'] as const) {
      expect(canLoadMore(status), status).toBe(false);
    }
    // The end of the list reaches the caller in that one status.
    setViewport(...COMPACT);
    flash.standIn = true;
    const onEndReached = vi.fn();
    for (const status of ['loadingMore', 'moreFailed', 'end'] as const) {
      draw(<List<Row> {...STATES.ready} status={status} onEndReached={onEndReached} />);
      handed().onEndReached?.();
      expect(onEndReached, status).not.toHaveBeenCalled();
    }
    draw(<List<Row> {...STATES.ready} onEndReached={onEndReached} />);
    handed().onEndReached?.();
    expect(onEndReached).toHaveBeenCalledTimes(1);
    // A list with no next page takes the event and does nothing.
    drawState('ready');
    expect(() => handed().onEndReached?.()).not.toThrow();
  });

  it('remembers and recalls an offset by key', () => {
    rememberOffset('/x#list', 640);
    expect(recallOffset('/x#list')).toBe(640);
    expect(recallOffset('/never-seen#list')).toBeNull();
    rememberOffset('/x#list', 0);
    expect(recallOffset('/x#list')).toBe(0);
    rememberOffset('/x#list', 12);
    rememberOffset('/y#list', 900);
    expect(recallOffset('/x#list')).toBe(12);
    expect(recallOffset('/y#list')).toBe(900);
  });

  it('keeps its offset under its key and takes it back when it mounts again', () => {
    setViewport(...COMPACT);
    flash.standIn = true;
    const key = '/offices#restore';
    const view = draw(<List<Row> {...STATES.ready} restoreKey={key} />);
    // Nothing kept yet: the list opens at its top and scrolls nowhere.
    expect(flash.scrollToOffset).not.toHaveBeenCalled();
    scrollTo(120);
    scrollTo(640);
    expect(recallOffset(key)).toBe(640);
    expect(view).toBeDefined();

    // Mounted again, it goes back before the first paint, at once and once.
    draw(<List<Row> {...STATES.ready} restoreKey={key} />);
    expect(flash.scrollToOffset).toHaveBeenCalledTimes(1);
    expect(flash.scrollToOffset).toHaveBeenLastCalledWith({ offset: 640, animated: false });
    scrollTo(700);
    expect(flash.scrollToOffset).toHaveBeenCalledTimes(1);
    expect(recallOffset(key)).toBe(700);

    // A list that loads first goes back once its items are there.
    cleanup();
    flash.scrollToOffset.mockClear();
    const loaded = renderWithProviders(
      <List<Row> {...STATES.ready} status="loading" restoreKey={key} />,
    );
    expect(flash.scrollToOffset).not.toHaveBeenCalled();
    loaded.rerender(<List<Row> {...STATES.ready} restoreKey={key} />);
    expect(flash.scrollToOffset).toHaveBeenCalledTimes(1);
    expect(flash.scrollToOffset).toHaveBeenLastCalledWith({ offset: 700, animated: false });

    // Without a key nothing is kept and nothing is taken back.
    drawState('ready');
    scrollTo(333);
    expect(flash.scrollToOffset).not.toHaveBeenCalled();
    expect(recallOffset(key)).toBe(700);
  });

  it('scrolls to the top on a reselect of its tab', () => {
    setViewport(...COMPACT);
    flash.standIn = true;
    const inShell = (active: 'home' | 'explore'): JSX.Element => (
      <ShellLayout {...SHELL_STATES.signedOutHome} active={active} breakpoint="compact">
        <List<Row> {...STATES.ready} />
      </ShellLayout>
    );
    cleanup();
    const view = renderWithProviders(inShell('home'));
    flash.scrollToOffset.mockClear();
    emitReselect('explore');
    expect(flash.scrollToOffset).not.toHaveBeenCalled();
    emitReselect('home');
    expect(flash.scrollToOffset).toHaveBeenCalledTimes(1);
    expect(flash.scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: true });
    // It keeps the tab it first drew under while another is the active one.
    view.rerender(inShell('explore'));
    emitReselect('explore');
    expect(flash.scrollToOffset).toHaveBeenCalledTimes(1);
    emitReselect('home');
    expect(flash.scrollToOffset).toHaveBeenCalledTimes(2);

    // Under reduced motion it jumps.
    draw(inShell('home'), { reducedMotion: true });
    emitReselect('home');
    expect(flash.scrollToOffset).toHaveBeenLastCalledWith({ offset: 0, animated: false });
    // Outside any shell there is no tab to choose again.
    drawState('ready');
    emitReselect('home');
    expect(flash.scrollToOffset).not.toHaveBeenCalled();
  });

  it('reports the keys of the items in view at the threshold of the video module', () => {
    setViewport(...COMPACT);
    flash.standIn = true;
    const onVisibleChange = vi.fn();
    draw(<List<Row> {...STATES.ready} onVisibleChange={onVisibleChange} />);
    expect(handed().viewabilityConfig).toEqual({ itemVisiblePercentThreshold: 60 });
    expect(video.visibleThreshold).toBe(60);
    const rows = STATES.ready.items;
    see(
      [rows[2], rows[3]].filter((row) => row !== undefined),
      rows,
    );
    expect(onVisibleChange).toHaveBeenLastCalledWith(['office-3', 'office-4']);
    see<Row>([], rows);
    expect(onVisibleChange).toHaveBeenLastCalledWith([]);
    // The same constant at every render, so the library never sees it change.
    const before = handed().viewabilityConfig;
    see<Row>([], rows);
    expect(handed().viewabilityConfig).toBe(before);

    // A list nobody asked about its items does not watch them.
    drawState('ready');
    expect(handed().onViewableItemsChanged).toBeNull();
  });

  it('picks the first visible video and preloads the next', () => {
    expect(pickVideoTargets([B, C], CLIPS, videoOf)).toEqual({
      activeKey: 'video-b',
      preload: { key: 'video-d', url: 'https://media.example/d.mp4' },
    });
    expect(pickVideoTargets([], CLIPS, videoOf)).toEqual({ activeKey: null, preload: null });
    expect(pickVideoTargets([D], CLIPS, videoOf)).toEqual({ activeKey: 'video-d', preload: null });
    // An item with no video is never the one that plays, and nothing is loaded ahead of none.
    expect(pickVideoTargets([A, C], CLIPS, videoOf)).toEqual({ activeKey: null, preload: null });
    // The first in the list's order, whatever order the items in view arrive in.
    expect(pickVideoTargets([D, C, B], CLIPS, videoOf).activeKey).toBe('video-b');
  });

  it('useIsActiveVideo answers for the active key only', () => {
    setViewport(...COMPACT);
    flash.standIn = true;
    vi.useFakeTimers();
    draw(clipList({ videoOf }));
    // Nothing plays until the list has settled.
    expect(CLIPS.map((clip) => playing(clip.id))).toEqual(['false', 'false', 'false', 'false']);
    see([B, C], CLIPS);
    expect(playing('b')).toBe('false');
    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(playing('b')).toBe('false');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(CLIPS.map((clip) => playing(clip.id))).toEqual(['false', 'true', 'false', 'false']);
    // Outside any list nothing is active.
    draw(<Playing id="b" />);
    expect(playing('b')).toBe('false');
  });

  it('makes one video active each time the list settles, and loads the next ahead', () => {
    setViewport(...COMPACT);
    flash.standIn = true;
    vi.useFakeTimers();
    const preload = vi.spyOn(video.controller, 'preload');
    const view = draw(clipList({ videoOf }));
    expect(view).toBeDefined();
    see([B, C], CLIPS);
    // Scroll events keep the list from settling: the wait starts again at each one.
    for (let step = 0; step < 5; step += 1) {
      act(() => {
        vi.advanceTimersByTime(200);
      });
      scrollTo(step * 40);
    }
    expect(playing('b')).toBe('false');
    expect(videoFake.calls).toEqual([]);
    // The end of the momentum settles it at once.
    act(() => {
      handed().onMomentumScrollEnd?.({} as NativeSyntheticEvent<NativeScrollEvent>); // the list reads nothing of it
    });
    expect(playing('b')).toBe('true');
    expect(videoFake.calls).toEqual([{ op: 'preload', itemId: 'video-d' }]);
    expect(preload).toHaveBeenLastCalledWith('video-d', {
      uri: 'https://media.example/d.mp4',
      cacheKey: 'video-d',
    });
    // The wait that was running is over: nothing more happens when its time comes.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(videoFake.calls).toHaveLength(1);

    // The clip loaded ahead becomes the active one: it is not dropped.
    see([D], CLIPS);
    expect(playing('b')).toBe('true');
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(CLIPS.map((clip) => playing(clip.id))).toEqual(['false', 'false', 'false', 'true']);
    expect(videoFake.calls).toHaveLength(1);

    // Back at the first video, the next is loaded ahead again; with no video in view it is dropped.
    see([A, B], CLIPS);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(playing('b')).toBe('true');
    expect(videoFake.calls.slice(1)).toEqual([{ op: 'preload', itemId: 'video-d' }]);
    see([A], CLIPS);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(CLIPS.map((clip) => playing(clip.id))).toEqual(['false', 'false', 'false', 'false']);
    expect(videoFake.calls.slice(2)).toEqual([{ op: 'cancelPreload', itemId: 'video-d' }]);
  });

  it('drops a clip it loaded ahead when it goes away', () => {
    setViewport(...COMPACT);
    flash.standIn = true;
    vi.useFakeTimers();
    draw(clipList({ videoOf }));
    see([B], CLIPS);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(videoFake.calls).toEqual([{ op: 'preload', itemId: 'video-d' }]);
    cleanup();
    expect(videoFake.calls).toEqual([
      { op: 'preload', itemId: 'video-d' },
      { op: 'cancelPreload', itemId: 'video-d' },
    ]);
    // A wait that was running when the list went away does nothing.
    draw(clipList({ videoOf }));
    see([B], CLIPS);
    cleanup();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(videoFake.calls).toHaveLength(2);
  });

  it('never reaches the video module without videoOf', () => {
    setViewport(...COMPACT);
    flash.standIn = true;
    vi.useFakeTimers();
    const preload = vi.spyOn(video.controller, 'preload');
    const cancel = vi.spyOn(video.controller, 'cancelPreload');
    draw(clipList({ onVisibleChange: () => undefined }));
    see([B, C], CLIPS);
    scrollTo(200);
    act(() => {
      handed().onMomentumScrollEnd?.({} as NativeSyntheticEvent<NativeScrollEvent>); // the list reads nothing of it
      vi.advanceTimersByTime(1000);
    });
    cleanup();
    expect(preload).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    expect(videoFake.calls).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('has a label and a role', () => {
    setViewport(...COMPACT);
    flash.standIn = true;
    for (const state of STATE_NAMES) {
      const root = drawState(state);
      for (const control of root.querySelectorAll<HTMLElement>(
        'a, button, [role="button"], [role="link"]',
      )) {
        expect(control.getAttribute('role') ?? control.tagName.toLowerCase(), state).toBe('button');
        expect(control.getAttribute('aria-label'), state).toMatch(/^[A-Z]/);
      }
      // The list itself takes no role: its rows and its states carry their own.
      expect(root.getAttribute('role'), state).toBeNull();
    }
  });

  it('its scroll element is a named Tab stop with the focus ring on the web', () => {
    setViewport(...COMPACT);
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        const root = drawState(state, { theme });
        const stops = root.querySelectorAll<HTMLElement>('[tabindex="0"]');
        const scrolls = [...stops].filter((element) => element.getAttribute('role') === 'group');
        if (state === 'loading' || state === 'loadingRows' || state === 'empty') {
          // Skeletons and the empty state scroll nothing.
          expect(scrolls, state).toHaveLength(0);
          continue;
        }
        expect(scrolls, state).toHaveLength(1);
        const scroll = scrolls[0];
        if (scroll === undefined) throw new Error('no scroll element');
        expect(scroll.getAttribute('aria-label'), state).toBe('Scrolling list');
        // The element that scrolls is the one that takes focus.
        expect(scroll.style.overflowY || getComputedStyle(scroll).overflowY, state).toMatch(
          /^(auto|scroll)$/,
        );
        expect(scroll.style.outlineStyle, state).toBe('');
        act(() => {
          scroll.focus();
        });
        expect(document.activeElement, state).toBe(scroll);
        expect(scroll.style.outlineStyle, state).toBe('solid');
        expect(scroll.style.outlineWidth, state).toBe(`${String(rule.focus)}px`);
        expect(scroll.style.outlineColor, state).toBe(written(color[theme].focusRing));
        // It fills the box that clips it, so the ring sits inside its edge.
        expect(scroll.style.outlineOffset, state).toBe(
          `${String(-(rule.focus + rule.focusGap))}px`,
        );
        act(() => {
          scroll.blur();
        });
        expect(scroll.style.outlineStyle, state).toBe('');
      }
    }
  });

  it('has a testID', () => {
    setViewport(...COMPACT);
    flash.standIn = true;
    const expected: Record<StateName, string[]> = {
      loading: [],
      loadingRows: [],
      ready: [],
      loadingMore: [],
      moreFailed: ['gallery.list-more-failed-retry-more'],
      end: [],
      empty: [],
      dotted: [],
    };
    for (const state of STATE_NAMES) {
      const root = drawState(state);
      expect(root.getAttribute('data-testid'), state).toBe(STATES[state].testID);
      const ids = [...root.querySelectorAll('[data-testid]')].map((element) =>
        element.getAttribute('data-testid'),
      );
      expect(ids, state).toEqual(expected[state]);
      for (const id of ids) {
        expect(id, state).toMatch(TEST_ID);
      }
    }
  });

  it('respects reduced motion', () => {
    setViewport(...COMPACT);
    vi.useFakeTimers();
    // The skeletons of a loading list hold still; nothing else in a list moves by itself.
    for (const state of ['loading', 'loadingRows', 'loadingMore'] as const) {
      const root = drawState(state, { reducedMotion: true });
      const skeletons = within(root).getAllByRole('progressbar');
      act(() => {
        vi.advanceTimersByTime(600);
      });
      for (const skeleton of skeletons) {
        expect(['', '1'], state).toContain(skeleton.style.opacity);
      }
    }
    // Where motion is allowed they pulse together.
    const root = drawState('loading');
    act(() => {
      vi.advanceTimersByTime(600);
    });
    const opacities = within(root)
      .getAllByRole('progressbar')
      .map((skeleton) => skeleton.style.opacity);
    expect(new Set(opacities).size).toBe(1);
    expect(Number(opacities[0])).toBeLessThan(1);
  });
});
