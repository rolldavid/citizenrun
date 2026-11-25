import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useRef } from 'react';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { HostInstance } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { motion } from '@/ui/motion';
import { color, gutter, radius, rule, size, space, z } from '@/ui/tokens';

import { Popover } from './popover';
import { Pressable } from './pressable';
import type { PopoverProps } from './popover';
import { GROUND, PREVIEW, STATES } from './popover.fixtures';

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

const STATE_NAMES = [
  'belowStart',
  'belowEnd',
  'aboveStart',
  'aboveEnd',
  'end',
  'padded',
  'narrowAnchor',
] as const;

const ALL: Readonly<Record<StateName, PopoverProps>> = STATES;

const NARROW = [360, 740] as const;
const EXPANDED = [1440, 900] as const;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.popover';
const ANCHOR = 'probe.anchor';
/** Where the cases below stand the anchor unless they say otherwise: clear of every edge. */
const MIDDLE = { x: 600, y: 400, width: 120, height: 44 };
/** Four rows of a list, as the fixtures draw them. */
const ROWS_HIGH = 176;
const GAP = space.x2;

type Place = { x: number; y: number; width: number; height: number };

beforeEach(() => {
  vi.useFakeTimers();
  setViewport(...EXPANDED);
});

afterEach(() => {
  vi.useRealTimers();
});

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** A popover and the control it stands by, which a case places in the window. */
function Anchored({
  props,
  anchorID = ANCHOR,
}: {
  props: PopoverProps;
  anchorID?: string;
}): JSX.Element {
  const anchor = useRef<HostInstance>(null);
  return (
    <>
      <View ref={anchor} testID={anchorID} />
      <Popover {...props} anchor={anchor} />
    </>
  );
}

/** A popover under the probe id: open, with a line of text, unless told otherwise. */
function probe(given: Partial<PopoverProps> = {}): PopoverProps {
  return {
    open: true,
    onClose: () => undefined,
    anchor: { current: null },
    label: 'Jump to a place',
    testID: PROBE,
    children: <View testID="probe.content" />,
    ...given,
  };
}

/** Says where the page drew an element, for the measure an opening popover asks for. */
function placeAt(testID: string, place: Place): void {
  const element = screen.getByTestId(testID);
  element.getBoundingClientRect = () => new DOMRect(place.x, place.y, place.width, place.height);
}

/** Lets the measure of the anchor come back: the page answers it on the next turn. */
function settle(): void {
  act(() => {
    vi.advanceTimersByTime(1);
  });
}

/**
 * Tells the popover how tall all it holds is, as the page does. jsdom lays nothing out, so the
 * handler the page keeps on the element is called directly:
 * https://github.com/necolas/react-native-web/blob/0.21.2/packages/react-native-web/src/modules/useElementLayout/index.js
 */
function layOut(surface: HTMLElement, height: number): void {
  const content = [...surface.querySelectorAll('*')].find(
    (element) => typeof Reflect.get(element, '__reactLayoutHandler') === 'function',
  );
  if (content === undefined) {
    throw new Error('the popover listens for no layout');
  }
  const handler: unknown = Reflect.get(content, '__reactLayoutHandler');
  const width = Number.parseFloat(surface.style.width);
  act(() => {
    Reflect.apply(handler as () => void, content, [
      { nativeEvent: { layout: { x: 0, y: 0, width, height } } },
    ]);
  });
}

/** Stands the anchor at `place`, gives the popover the height of its content and lets it fade in. */
function open(testID: string, place: Place = MIDDLE, height = ROWS_HIGH): HTMLElement {
  placeAt(ANCHOR, place);
  settle();
  const surface = screen.getByTestId(testID);
  layOut(surface, height);
  act(() => {
    vi.advanceTimersByTime(motion.duration.fade);
  });
  return screen.getByTestId(testID);
}

/** Renders one popover by its anchor, in place of whatever was drawn before, placed and faded in. */
function draw(
  props: PopoverProps,
  place: Place = MIDDLE,
  options: RenderWithProvidersOptions = {},
  height = ROWS_HIGH,
): HTMLElement {
  cleanup();
  renderWithProviders(<Anchored props={props} />, options);
  return open(props.testID, place, height);
}

/** The view that holds what the popover scrolls: the padding is its own. */
function contentOf(surface: HTMLElement): HTMLElement {
  const content = surface.firstElementChild?.firstElementChild;
  if (!(content instanceof HTMLElement)) {
    throw new Error('the popover holds nothing');
  }
  return content;
}

/** A press and release of Escape, as a key press sends them to the page. */
function pressEscape(): void {
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.keyUp(document, { key: 'Escape' });
}

describe('Popover', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        const surface = draw(ALL[state], MIDDLE, { theme });
        // Flat: the surface inside a hairline of rule on every side, square, with no shadow.
        expect(surface.style.backgroundColor, state).toBe(written(color[theme].surface));
        expect(surface.style.borderWidth, state).toBe(`${String(rule.hairline)}px`);
        expect(surface.style.borderColor, state).toBe(written(color[theme].rule));
        expect(surface.style.borderRadius, state).toBe(`${String(radius.none)}px`);
        expect(surface.style.boxShadow, state).toBe('');
        expect(surface.style.zIndex, state).toBe(String(z.popover));
        expect(surface.style.opacity, state).toBe('1');
        // Never narrower than a popover may be, whatever its anchor.
        expect(surface.style.width, state).toBe(`${String(size.popoverMin)}px`);
        // Only a list of rows gives the padding up.
        expect(contentOf(surface).style.padding, state).toBe(
          ALL[state].padded === false ? '' : `${String(space.x6)}px`,
        );
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the seven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.belowStart.placement).toBe('below-start');
    expect(STATES.belowEnd.placement).toBe('below-end');
    expect(STATES.aboveStart.placement).toBe('above-start');
    expect(STATES.aboveEnd.placement).toBe('above-end');
    expect(STATES.end.placement).toBe('end');
    expect(STATES.belowStart.padded).toBe(false);
    expect(Object.keys(STATES.padded)).not.toContain('padded');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const surface = draw(ALL[state]);
      expect(screen.getByRole('dialog', { name: ALL[state].label }), state).toBe(surface);
      // Everything to press inside it has a name and a role of its own.
      for (const row of within(surface).queryAllByRole('button')) {
        expect(row.getAttribute('aria-label') ?? '', state).not.toBe('');
      }
      expect(
        surface.querySelectorAll('[tabindex="0"]:not([role]), a:not([aria-label])'),
        state,
      ).toHaveLength(0);
    }
    expect(within(draw(STATES.belowStart)).getAllByRole('button')).toHaveLength(4);
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const surface = draw(ALL[state]);
      expect(ALL[state].testID, state).toMatch(TEST_ID);
      expect(surface.getAttribute('data-testid'), state).toBe(ALL[state].testID);
      // The window behind it, which closes it, is the same id with its part.
      expect(screen.getByTestId(`${ALL[state].testID}-backdrop`), state).toBeDefined();
      expect(`${ALL[state].testID}-backdrop`, state).toMatch(TEST_ID);
      const ids = within(surface)
        .queryAllByRole('button')
        .map((row) => row.getAttribute('data-testid') ?? '');
      for (const id of ids) {
        expect(id, state).toMatch(TEST_ID);
      }
      expect(new Set(ids).size, state).toBe(ids.length);
    }
  });

  it('respects reduced motion', () => {
    cleanup();
    const view = renderWithProviders(<Anchored props={probe()} />, { reducedMotion: true });
    placeAt(ANCHOR, MIDDLE);
    settle();
    const surface = screen.getByTestId(PROBE);
    layOut(surface, ROWS_HIGH);
    // The preset is the fade it already is: opacity alone, and nothing moves or grows.
    expect(surface.style.opacity).toBe('0');
    act(() => {
      vi.advanceTimersByTime(motion.duration.fade);
    });
    expect(surface.style.opacity).toBe('1');
    expect(surface.style.transform).toBe('');
    expect(surface.style.animationName).toBe('');
    view.rerender(<Anchored props={probe({ open: false })} />);
    expect(surface.style.opacity).toBe('0');
    expect(surface.style.transform).toBe('');
    act(() => {
      vi.advanceTimersByTime(motion.duration.fade);
    });
    expect(screen.queryByTestId(PROBE)).toBeNull();
  });

  it('opens and closes', () => {
    const onClose = vi.fn();
    draw({ ...STATES.belowStart, onClose });
    const backdrop = screen.getByTestId(`${STATES.belowStart.testID}-backdrop`);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
    // The window behind the surface: all of it, with no fill, and no stop for the keyboard.
    expect(backdrop.style.position).toBe('absolute');
    expect(backdrop.style.backgroundColor).toBe('');
    expect(backdrop.getAttribute('tabindex')).toBe('-1');
    expect(backdrop.getAttribute('role')).toBeNull();
    expect(backdrop.style.cursor).toBe('auto');

    // A closed popover draws nothing.
    cleanup();
    renderWithProviders(<Anchored props={probe({ open: false })} />);
    expect(screen.queryByTestId(PROBE)).toBeNull();
    expect(screen.queryByTestId(`${PROBE}-backdrop`)).toBeNull();
  });

  it('Esc closes it, and a press inside it does not', () => {
    const onClose = vi.fn();
    const surface = draw(probe({ onClose }));
    fireEvent.click(surface);
    fireEvent.click(within(surface).getByTestId('probe.content'));
    expect(onClose).not.toHaveBeenCalled();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('one at a time', () => {
    const closeFirst = vi.fn();
    const closeSecond = vi.fn();
    function Two({ first, second }: { first: boolean; second: boolean }): JSX.Element {
      return (
        <>
          <Anchored
            props={probe({ open: first, onClose: closeFirst, testID: 'probe.first' })}
            anchorID="probe.anchor-first"
          />
          <Anchored
            props={probe({ open: second, onClose: closeSecond, testID: 'probe.second' })}
            anchorID="probe.anchor-second"
          />
        </>
      );
    }
    cleanup();
    const view = renderWithProviders(<Two first={true} second={false} />);
    expect(closeFirst).not.toHaveBeenCalled();
    // The second opens while the first is still open: the first is told to close.
    view.rerender(<Two first={true} second={true} />);
    expect(closeFirst).toHaveBeenCalledTimes(1);
    expect(closeSecond).not.toHaveBeenCalled();
    view.rerender(<Two first={false} second={true} />);
    expect(closeSecond).not.toHaveBeenCalled();

    // Closing the one that is open tells nobody, and so does opening one with none open.
    view.rerender(<Two first={false} second={false} />);
    act(() => {
      vi.advanceTimersByTime(motion.duration.fade);
    });
    view.rerender(<Two first={true} second={false} />);
    expect(closeFirst).toHaveBeenCalledTimes(1);
    expect(closeSecond).not.toHaveBeenCalled();
    // And it works the other way round.
    view.rerender(<Two first={false} second={false} />);
    act(() => {
      vi.advanceTimersByTime(motion.duration.fade);
    });
    view.rerender(<Two first={false} second={true} />);
    view.rerender(<Two first={true} second={true} />);
    expect(closeSecond).toHaveBeenCalledTimes(1);
    expect(closeFirst).toHaveBeenCalledTimes(1);
  });

  it('named dialog', () => {
    const surface = draw(probe({ label: 'Open this office in the app' }));
    expect(screen.getByRole('dialog', { name: 'Open this office in the app' })).toBe(surface);
    expect(surface.getAttribute('aria-label')).toBe('Open this office in the app');
    expect(surface.getAttribute('aria-modal')).toBe('true');
    // The one named dialog on the page.
    expect(screen.getAllByRole('dialog', { name: /./ })).toEqual([surface]);
    expect(document.querySelectorAll('dialog')).toHaveLength(0);
    // The surface comes before the window behind it, so focus starts inside it.
    const backdrop = screen.getByTestId(`${PROBE}-backdrop`);
    expect(surface.compareDocumentPosition(backdrop) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );
  });

  it('fades and never scales', () => {
    for (const reducedMotion of [false, true]) {
      cleanup();
      const view = renderWithProviders(<Anchored props={probe({ open: false })} />, {
        reducedMotion,
      });
      expect(screen.queryByTestId(PROBE)).toBeNull();
      view.rerender(<Anchored props={probe()} />);
      const surface = screen.getByTestId(PROBE);
      // Laid out clear until its place is known, so the fade has somewhere to start.
      expect(surface.style.opacity).toBe('0');
      placeAt(ANCHOR, MIDDLE);
      settle();
      layOut(surface, ROWS_HIGH);
      act(() => {
        vi.advanceTimersByTime(motion.duration.fade);
      });
      expect(surface.style.opacity).toBe('1');
      // Opacity is the one thing that changes: no scale, no slide.
      expect(surface.style.transform).toBe('');
      expect(surface.style.animationName).toBe('');
      for (const part of surface.querySelectorAll<HTMLElement>('*')) {
        expect(part.style.transform).toBe('');
      }

      // Closing is the same fade back, and the popover stays until it has run.
      view.rerender(<Anchored props={probe({ open: false })} />);
      expect(surface.style.opacity).toBe('0');
      expect(surface.style.transform).toBe('');
      act(() => {
        vi.advanceTimersByTime(motion.duration.fade - 1);
      });
      expect(screen.queryByTestId(PROBE)).toBe(surface);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.queryByTestId(PROBE)).toBeNull();
    }
  });

  it('stays unseen until both its anchor and its own size are known', () => {
    // Its anchor alone is not enough.
    cleanup();
    renderWithProviders(<Anchored props={probe()} />);
    placeAt(ANCHOR, MIDDLE);
    const surface = screen.getByTestId(PROBE);
    act(() => {
      vi.advanceTimersByTime(motion.duration.fade);
    });
    expect(surface.style.opacity).toBe('0');
    layOut(surface, ROWS_HIGH);
    act(() => {
      vi.advanceTimersByTime(motion.duration.fade);
    });
    expect(surface.style.opacity).toBe('1');
    expect(surface.style.top).toBe(`${String(MIDDLE.y + MIDDLE.height + GAP)}px`);

    // Nor is its own size: a popover whose anchor is not drawn has no place to stand.
    cleanup();
    renderWithProviders(<Popover {...probe()} />);
    const lost = screen.getByTestId(PROBE);
    layOut(lost, ROWS_HIGH);
    act(() => {
      vi.advanceTimersByTime(motion.duration.fade);
    });
    expect(lost.style.opacity).toBe('0');
  });

  it('stands the gap from its anchor on the side asked for, an edge in line with it', () => {
    const high = ROWS_HIGH + rule.hairline * 2;
    const wide = size.popoverMin;
    const below = draw(probe({ placement: 'below-start' }));
    expect(below.style.top).toBe(`${String(MIDDLE.y + MIDDLE.height + GAP)}px`);
    expect(below.style.left).toBe(`${String(MIDDLE.x)}px`);
    const belowEnd = draw(probe({ placement: 'below-end' }));
    expect(belowEnd.style.top).toBe(`${String(MIDDLE.y + MIDDLE.height + GAP)}px`);
    expect(belowEnd.style.left).toBe(`${String(MIDDLE.x + MIDDLE.width - wide)}px`);
    const above = draw(probe({ placement: 'above-start' }));
    expect(above.style.top).toBe(`${String(MIDDLE.y - GAP - high)}px`);
    expect(above.style.left).toBe(`${String(MIDDLE.x)}px`);
    const aboveEnd = draw(probe({ placement: 'above-end' }));
    expect(aboveEnd.style.top).toBe(`${String(MIDDLE.y - GAP - high)}px`);
    expect(aboveEnd.style.left).toBe(`${String(MIDDLE.x + MIDDLE.width - wide)}px`);
    const end = draw(probe({ placement: 'end' }));
    expect(end.style.top).toBe(`${String(MIDDLE.y)}px`);
    expect(end.style.left).toBe(`${String(MIDDLE.x + MIDDLE.width + GAP)}px`);
    // With no placement given it stands under its anchor, their left edges in line.
    const plain = draw(probe());
    expect(plain.style.top).toBe(below.style.top);
    expect(plain.style.left).toBe(below.style.left);
  });

  it('turns to the other side where it would leave the window', () => {
    const high = ROWS_HIGH + rule.hairline * 2;
    const low = { ...MIDDLE, y: 840 };
    const over = draw(probe({ placement: 'below-start' }), low);
    expect(over.style.top).toBe(`${String(low.y - GAP - high)}px`);
    const top = { ...MIDDLE, y: 30 };
    const under = draw(probe({ placement: 'above-start' }), top);
    expect(under.style.top).toBe(`${String(top.y + top.height + GAP)}px`);
    // Beside an anchor at the right edge there is no room after it.
    const right = { ...MIDDLE, x: EXPANDED[0] - gutter.regular - MIDDLE.width };
    const before = draw(probe({ placement: 'end' }), right);
    expect(before.style.left).toBe(`${String(right.x - GAP - size.popoverMin)}px`);
  });

  it('is as wide as its anchor or as it is told, never under the least nor over the window', () => {
    const wideAnchor = { ...MIDDLE, width: 320 };
    expect(draw(probe(), wideAnchor).style.width).toBe('320px');
    expect(draw(probe({ width: 280 }), wideAnchor).style.width).toBe('280px');
    expect(draw(probe({ width: 120 }), wideAnchor).style.width).toBe(
      `${String(size.popoverMin)}px`,
    );
    expect(draw(STATES.narrowAnchor, { ...MIDDLE, width: size.target }).style.width).toBe(
      `${String(size.popoverMin)}px`,
    );
    // On the narrowest phone it keeps the gutter clear at each side.
    setViewport(...NARROW);
    const phone = draw(probe({ width: 600 }), { x: 16, y: 100, width: 120, height: 44 });
    expect(phone.style.width).toBe(`${String(NARROW[0] - gutter.narrow * 2)}px`);
    expect(phone.style.left).toBe(`${String(gutter.narrow)}px`);
  });

  it('scrolls what the window cannot hold', () => {
    const tall = draw(probe({ padded: false }), MIDDLE, {}, 2000);
    const roomBelow = EXPANDED[1] - gutter.regular - (MIDDLE.y + MIDDLE.height + GAP);
    const roomAbove = MIDDLE.y - GAP - gutter.regular;
    expect(roomBelow).toBeGreaterThan(roomAbove);
    expect(tall.style.maxHeight).toBe(`${String(roomBelow)}px`);
    expect(tall.style.top).toBe(`${String(MIDDLE.y + MIDDLE.height + GAP)}px`);
    // Content that fits is held to the same room and has nothing to scroll.
    const short = draw(probe({ padded: false }));
    expect(short.style.maxHeight).toBe(`${String(roomBelow)}px`);
    expect(short.style.height).toBe('');
  });

  it('measures its anchor again when the window changes size', () => {
    const surface = draw(probe());
    expect(surface.style.left).toBe(`${String(MIDDLE.x)}px`);
    // The page lays the anchor out somewhere else in the new window.
    placeAt(ANCHOR, { ...MIDDLE, x: 200, y: 300 });
    setViewport(820, 1180);
    settle();
    expect(surface.style.left).toBe('200px');
    expect(surface.style.top).toBe(`${String(300 + MIDDLE.height + GAP)}px`);
  });

  it('each opening measures the anchor where it stands then', () => {
    cleanup();
    const view = renderWithProviders(<Anchored props={probe()} />);
    const first = open(PROBE);
    expect(first.style.left).toBe(`${String(MIDDLE.x)}px`);
    view.rerender(<Anchored props={probe({ open: false })} />);
    act(() => {
      vi.advanceTimersByTime(motion.duration.fade);
    });
    expect(screen.queryByTestId(PROBE)).toBeNull();
    // The page has scrolled since: the anchor stands higher.
    view.rerender(<Anchored props={probe()} />);
    const again = open(PROBE, { ...MIDDLE, y: 120 });
    expect(again.style.top).toBe(`${String(120 + MIDDLE.height + GAP)}px`);
    expect(again.style.opacity).toBe('1');
  });

  it('focus starts inside it and goes back to what opened it', () => {
    function Opened({ isOpen, given }: { isOpen: boolean; given: PopoverProps }): JSX.Element {
      return (
        <>
          <Pressable role="button" label="Jump" testID="probe.opener" onPress={() => undefined}>
            <View />
          </Pressable>
          <Anchored props={{ ...given, open: isOpen }} />
        </>
      );
    }
    // A list of rows: the first row.
    cleanup();
    const view = renderWithProviders(<Opened isOpen={false} given={STATES.belowStart} />);
    const opener = screen.getByTestId('probe.opener');
    act(() => {
      opener.focus();
    });
    expect(document.activeElement).toBe(opener);
    view.rerender(<Opened isOpen={true} given={STATES.belowStart} />);
    const surface = open(STATES.belowStart.testID);
    expect(document.activeElement).toBe(within(surface).getAllByRole('button')[0]);
    view.rerender(<Opened isOpen={false} given={STATES.belowStart} />);
    act(() => {
      vi.advanceTimersByTime(motion.duration.fade);
    });
    expect(screen.queryByTestId(STATES.belowStart.testID)).toBeNull();
    expect(document.activeElement).toBe(opener);

    // Nothing to focus inside: focus still stands in the popover, never on the window behind it.
    view.rerender(<Opened isOpen={true} given={STATES.padded} />);
    const words = open(STATES.padded.testID);
    expect(words.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(screen.getByTestId(`${STATES.padded.testID}-backdrop`));
    // The place it stands is no stop for Tab, takes no room and draws no ring.
    const rest = document.activeElement;
    if (!(rest instanceof HTMLElement)) {
      throw new Error('nothing has the focus');
    }
    expect(rest.getAttribute('tabindex')).toBe('-1');
    expect(rest.childElementCount).toBe(0);
    expect(rest.style.outlineWidth).toBe('0px');
    expect(words.lastElementChild).toBe(rest);
  });
});
