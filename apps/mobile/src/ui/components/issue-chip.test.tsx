import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { hapticsFake } from '@/test/platform/haptics';
import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { ISSUE_IDS, color, isIssueId, issue } from '@/ui/tokens';

import { IssueChip, IssueGridChip } from './issue-chip';
import type { IssueChipProps } from './issue-chip';
import { GROUND, PREVIEW, STATES } from './issue-chip.fixtures';
import { InteractionPreview } from './pressable';
import type { InteractionPreviewState } from './pressable';

// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// A chip loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a chip loads no asset');
  },
}));

// The props each View receives: what a phone's screen reader is told, and the layout callback the
// page never runs here.
const views = vi.hoisted(() => {
  const state: { props: Record<string, unknown>[] } = { props: [] };
  return state;
});

// The props each native Text receives: the web writes a line limit where a test cannot read it.
const texts = vi.hoisted(() => {
  const state: { props: Record<string, unknown>[] } = { props: [] };
  return state;
});

vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactNative>();
  return {
    ...actual,
    View: (props: ReactNative.ViewProps): ReactElement => {
      views.props.push({ ...props });
      return createElement(actual.View, props);
    },
    Text: (props: ReactNative.TextProps): ReactElement => {
      texts.props.push({ ...props });
      return createElement(actual.Text, props);
    },
  };
});

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'idle',
  'selected',
  'selectedStarred',
  'selectedUnstarred',
  'displayMd',
  'displaySm',
  'longName',
  'unknown',
  'idleHovered',
  'idlePressed',
  'idleFocused',
] as const;

const ALL: Readonly<Record<StateName, IssueChipProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.issue-chip';
const STAR =
  'M12 3.500l2.600 5.600 6 .700-4.500 4.100 1.200 6-5.300-3-5.300 3 1.200-6L3.400 9.800l6-.700z';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

type Parts = {
  /** The chip: the view that holds the target, the drawing and the star. */
  root: HTMLElement;
  /** The checkbox under the drawing; null for a display chip. */
  target: HTMLElement | null;
  /** What the chip draws. */
  box: HTMLElement;
  tile: HTMLElement;
  line: HTMLElement;
  name: HTMLElement;
  outline: HTMLElement;
  /** The star's checkbox; null where the chip shows none. */
  star: HTMLElement | null;
};

/** The parts of the chip drawn under an id. */
function partsOf(testID: string): Parts {
  const found = screen.getByTestId(testID);
  const target = found.getAttribute('role') === 'checkbox' ? found : null;
  const root = target === null ? found : target.parentElement?.parentElement;
  const layers = [...(root?.children ?? [])] as HTMLElement[];
  const at = layers.findIndex((part) => part.style.overflow === 'hidden');
  const box = layers[at];
  // The outline is the chip's, not the drawing's: the layer after the drawing.
  const outline = layers[at + 1];
  const [tile, line, name] = [...(box?.children ?? [])] as HTMLElement[];
  if (!root || !box || !tile || !line || !name || !outline) {
    throw new Error('the chip is not drawn as a chip');
  }
  return {
    root,
    target,
    box,
    tile,
    line,
    name,
    outline,
    star: screen.queryByTestId(`${testID}-star`),
  };
}

/** Renders one state of the fixtures, inside its preview when it has one. */
function drawState(
  state: StateName,
  options: RenderWithProvidersOptions = {},
  preview: InteractionPreviewState | undefined = PREVIEW[state],
): Parts {
  cleanup();
  views.props = [];
  texts.props = [];
  const element = <IssueChip {...ALL[state]} />;
  renderWithProviders(
    preview === undefined ? (
      element
    ) : (
      <InteractionPreview state={preview}>{element}</InteractionPreview>
    ),
    options,
  );
  return partsOf(ALL[state].testID);
}

/** Renders one chip under the probe id: a control for rent unless told otherwise. */
function draw(given: Partial<IssueChipProps> = {}): Parts {
  cleanup();
  views.props = [];
  texts.props = [];
  renderWithProviders(
    <IssueChip
      issueId="rent-housing"
      name="Rent"
      onPress={() => undefined}
      testID={PROBE}
      {...given}
    />,
  );
  return partsOf(PROBE);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('IssueChip', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const chip = drawState(state, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const fixture = ALL[state];
          const on = fixture.selected === true;
          const side = fixture.size === 'sm' ? '32px' : '44px';
          // The box: at least as high as its tile, with the control radius, on the surface.
          expect(chip.root.style.minHeight, name).toBe(side);
          expect(chip.root.style.borderRadius, name).toBe('4px');
          expect(chip.root.style.backgroundColor, name).toBe(
            written(on ? color[theme].selectedBg : color[theme].surface),
          );
          expect(chip.box.style.flexDirection, name).toBe('row');
          expect(chip.box.style.borderRadius, name).toBe('4px');
          // The tile, flush at the left: the issue's color, or the well for an id not known.
          expect(chip.tile.style.width, name).toBe(side);
          expect(chip.tile.style.alignSelf, name).toBe('stretch');
          expect(chip.tile.style.backgroundColor, name).toBe(
            written(isIssueId(fixture.issueId) ? issue[fixture.issueId][theme] : color[theme].well),
          );
          expect(chip.tile.querySelectorAll('svg'), name).toHaveLength(1);
          // The line down the tile's right edge.
          expect(chip.line.style.width, name).toBe('1px');
          expect(chip.line.style.backgroundColor, name).toBe(
            written(on ? color[theme].selectedBg : color[theme].rule),
          );
          // The name: the label role, 12 points from the tile.
          const words = screen.getByText(fixture.name);
          expect(chip.name.contains(words), name).toBe(true);
          expect(parseFloat(words.style.fontSize), name).toBeCloseTo(14 * scale);
          expect(words.style.color, name).toBe(
            written(on ? color[theme].selectedText : color[theme].text),
          );
          expect(chip.name.style.paddingLeft, name).toBe('12px');
          // The outline: a hairline round the whole chip.
          expect(chip.outline.style.borderWidth, name).toBe('1px');
          expect(chip.outline.style.borderRadius, name).toBe('4px');
          expect(chip.outline.style.borderColor, name).toBe(
            written(on ? color[theme].selectedBg : color[theme].rule),
          );
          // Never the issue's color as the chip's fill, its outline or its text.
          for (const id of ISSUE_IDS) {
            const paint = written(issue[id][theme]);
            expect(chip.root.style.backgroundColor, name).not.toBe(paint);
            expect(chip.name.style.backgroundColor, name).not.toBe(paint);
            expect(chip.outline.style.borderColor, name).not.toBe(paint);
            expect(words.style.color, name).not.toBe(paint);
          }
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the eleven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.issue-chip-${kebab(state)}`);
    }
    expect(STATES.selectedStarred.star.starred).toBe(true);
    expect(STATES.selectedUnstarred.star.starred).toBe(false);
    expect(STATES.displaySm.size).toBe('sm');
    expect(STATES.unknown.issueId).toBe('not-an-issue');
    expect(PREVIEW).toEqual({
      idleHovered: { hovered: true },
      idlePressed: { pressed: true },
      idleFocused: { focused: true },
    });
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const chip = drawState(state);
      const fixture = ALL[state];
      const boxes = screen.queryAllByRole('checkbox');
      if (fixture.onPress === undefined) {
        // A display chip is no control: its name is read as text.
        expect(boxes, state).toHaveLength(0);
        expect(chip.box.getAttribute('aria-hidden'), state).toBeNull();
        continue;
      }
      const said = fixture.label ?? fixture.name;
      expect(screen.getByRole('checkbox', { name: said }), state).toBe(chip.target);
      expect(chip.target?.getAttribute('aria-checked'), state).toBe(
        String(fixture.selected === true),
      );
      expect(boxes, state).toHaveLength(chip.star === null ? 1 : 2);
      // The drawing is under the target, which says the name: it is read once.
      expect(chip.box.getAttribute('aria-hidden'), state).toBe('true');
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const chip = drawState(state);
      expect(ALL[state].testID, state).toMatch(TEST_ID);
      expect((chip.target ?? chip.root).getAttribute('data-testid'), state).toBe(ALL[state].testID);
      // Everything a person can press carries an id.
      for (const element of document.querySelectorAll('[role="checkbox"], a, button')) {
        expect(element.getAttribute('data-testid') ?? '', state).toMatch(TEST_ID);
      }
    }
    expect(drawState('selectedStarred').star?.getAttribute('data-testid')).toBe(
      'gallery.issue-chip-selected-starred-star',
    );
  });

  it('respects reduced motion', () => {
    // A chip cuts between its states: nothing in it moves or fades, with reduced motion or without.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const chip = drawState(state, { reducedMotion }, { pressed: true });
        for (const part of [chip.root, ...chip.root.querySelectorAll<HTMLElement>('*')]) {
          if (chip.star?.contains(part) === true) {
            continue;
          }
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
        }
      }
    }
    // The star is a small target of its own and holds still under reduced motion.
    const still = drawState('selectedStarred', { reducedMotion: true }, { pressed: true });
    for (const part of still.star?.querySelectorAll<HTMLElement>('*') ?? []) {
      expect(['', 'translateY(0px) scale(1)']).toContain(part.style.transform);
      expect(part.style.transition).toBe('');
    }
  });

  it('toggles as a checkbox', () => {
    const onPress = vi.fn();
    const chip = draw({ onPress });
    expect(chip.target?.getAttribute('role')).toBe('checkbox');
    expect(chip.target?.getAttribute('aria-checked')).toBe('false');
    expect(chip.target?.getAttribute('tabindex')).toBe('0');
    fireEvent.click(chip.target as HTMLElement);
    expect(onPress).toHaveBeenCalledTimes(1);
    // The caller holds the answer: the chip is selected once the caller says so.
    expect(chip.target?.getAttribute('aria-checked')).toBe('false');
    const on = draw({ onPress, selected: true });
    expect(on.target?.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(on.target as HTMLElement);
    expect(onPress).toHaveBeenCalledTimes(2);
    // The fixture is the same control.
    const idle = drawState('idle');
    expect(idle.target?.getAttribute('role')).toBe('checkbox');
    expect(idle.target?.getAttribute('aria-checked')).toBe('false');
  });

  it('Space toggles from the keyboard', () => {
    const onPress = vi.fn();
    const chip = draw({ onPress });
    const target = chip.target as HTMLElement;
    act(() => {
      target.focus();
    });
    // The page presses on Space itself and cancels the key, so the page does not scroll.
    expect(fireEvent.keyDown(target, { key: ' ' })).toBe(false);
    fireEvent.keyUp(target, { key: ' ' });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('the selection haptic', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.advanceTimersByTime(1000);
    const chip = draw();
    fireEvent.click(chip.target as HTMLElement);
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }]);
    vi.advanceTimersByTime(1000);
    const starred = draw({
      selected: true,
      star: { starred: false, onToggle: () => undefined, label: 'Star Rent' },
    });
    fireEvent.click(starred.star as HTMLElement);
    expect(hapticsFake.calls).toEqual([{ method: 'selection' }, { method: 'selection' }]);
  });

  it('full accessible name', () => {
    const chip = draw({ name: 'Rent', label: 'Rent and housing costs' });
    expect(screen.getByRole('checkbox', { name: 'Rent and housing costs' })).toBe(chip.target);
    expect(chip.target?.getAttribute('aria-label')).toBe('Rent and housing costs');
    // The chip prints the short name, and only once.
    expect(chip.name.textContent).toBe('Rent');
    expect(chip.root.textContent).toBe('Rent');
    // Without a full name the short one is the name.
    expect(draw({ name: 'Rent' }).target?.getAttribute('aria-label')).toBe('Rent');
    const idle = drawState('idle');
    expect(idle.target?.getAttribute('aria-label')).toBe('Rent and housing costs');
    expect(idle.name.textContent).toBe('Rent');
  });

  it('the star is a sibling', () => {
    const onPress = vi.fn();
    const onToggle = vi.fn();
    const chip = draw({
      onPress,
      selected: true,
      star: { starred: false, onToggle, label: 'Star Rent' },
    });
    const star = chip.star as HTMLElement;
    // Neither target holds the other.
    expect(chip.target?.contains(star)).toBe(false);
    expect(star.contains(chip.target)).toBe(false);
    expect(chip.root.contains(star)).toBe(true);
    expect(chip.box.contains(star)).toBe(false);
    // The star is a checkbox with the caller's name for it.
    expect(screen.getByRole('checkbox', { name: 'Star Rent' })).toBe(star);
    expect(star.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(star);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
    fireEvent.click(chip.target as HTMLElement);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
    // The fixture: an outline star, not ticked, named by its label.
    const unstarred = drawState('selectedUnstarred');
    expect(unstarred.star?.getAttribute('aria-label')).toBe('Star Wages');
    expect(unstarred.star?.getAttribute('aria-checked')).toBe('false');
    expect(unstarred.target?.contains(unstarred.star)).toBe(false);
  });

  it('the star: outline or filled, in the inverse color, at the right end', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const state of ['selectedStarred', 'selectedUnstarred'] as const) {
        const chip = drawState(state, { theme });
        const star = chip.star as HTMLElement;
        const name = `${state} ${theme}`;
        const path = star.querySelector('path');
        expect(path?.getAttribute('d'), name).toBe(STAR);
        expect(path?.getAttribute('stroke'), name).toBe(color[theme].inverseText);
        expect(path?.getAttribute('fill'), name).toBe(
          ALL[state].star?.starred === true ? color[theme].inverseText : 'none',
        );
        expect(star.querySelector('svg')?.getAttribute('width'), name).toBe('20');
        expect(star.getAttribute('aria-checked'), name).toBe(String(ALL[state].star?.starred));
        // A full target at the chip's right end, with the name kept clear of the drawing.
        const zone = star.parentElement as HTMLElement;
        expect(zone.style.position, name).toBe('absolute');
        expect(zone.style.right, name).toBe('0px');
        expect(zone.style.width, name).toBe('44px');
        const drawn = star.querySelector<HTMLElement>('[style*="height: 44px"]');
        expect(drawn?.style.width, name).toBe('44px');
        expect(drawn?.style.paddingRight, name).toBe('8px');
        expect(chip.name.style.paddingRight, name).toBe('32px');
      }
    }
    // No star on a chip that is not selected, or where the caller gives none.
    const press = (): void => undefined;
    expect(draw({ star: { starred: true, onToggle: press, label: 'Star Rent' } }).star).toBeNull();
    expect(draw({ selected: true, star: null }).star).toBeNull();
    const plain = draw({ selected: true });
    expect(plain.star).toBeNull();
    expect(plain.name.style.paddingRight).toBe('12px');
  });

  it('display only', () => {
    for (const state of ['displayMd', 'displaySm'] as const) {
      const chip = drawState(state);
      expect(chip.target, state).toBeNull();
      expect(chip.root.getAttribute('role'), state).toBeNull();
      expect(chip.root.getAttribute('tabindex'), state).toBeNull();
      expect(chip.root.querySelectorAll('[role], [tabindex], a, button'), state).toHaveLength(0);
      // Its name is on the page for a screen reader, with nothing hiding it.
      expect(screen.getByText(ALL[state].name).closest('[aria-hidden="true"]'), state).toBeNull();
      // A pointer changes nothing on it.
      fireEvent.click(chip.root);
      expect(hapticsFake.calls, state).toEqual([]);
    }
    expect(drawState('displaySm').root.style.minHeight).toBe('32px');
    expect(drawState('displaySm').tile.querySelector('svg')?.getAttribute('width')).toBe('16');
    expect(drawState('displayMd').tile.querySelector('svg')?.getAttribute('width')).toBe('20');
  });

  it('inversion', () => {
    for (const theme of ['light', 'dark'] as const) {
      const chip = drawState('selected', { theme });
      // The box and the name area invert, and the name is drawn in the inverse tone.
      expect(chip.root.style.backgroundColor, theme).toBe(written(color[theme].selectedBg));
      expect(chip.name.style.backgroundColor, theme).toBe(written(color[theme].selectedBg));
      expect(screen.getByText('Rent').style.color, theme).toBe(written(color[theme].inverseText));
      expect(color[theme].selectedText, theme).toBe(color[theme].inverseText);
      // The tile keeps its color, inside a keyline in the selected text color.
      expect(chip.tile.style.backgroundColor, theme).toBe(written(issue['rent-housing'][theme]));
      const keyline = [...chip.tile.querySelectorAll<HTMLElement>('*')].find(
        (part) => part.style.borderColor === written(color[theme].selectedText),
      );
      expect(keyline?.style.borderWidth, theme).toBe('1px');
      // The keyline stands inside a ring of the chip's own ground, clear of its corners.
      const ring = keyline?.parentElement;
      expect(ring?.style.position, theme).toBe('absolute');
      expect(ring?.style.borderColor, theme).toBe(written(color[theme].selectedBg));
      expect(ring?.style.borderWidth, theme).toBe('1px');
    }
    // A chip that is not selected draws no keyline.
    const idle = drawState('idle');
    expect(idle.tile.childElementCount).toBe(1);
    expect(drawState('selected').tile.childElementCount).toBe(2);
  });

  it('a pointer and a press fill the name area, and the tile keeps its color', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const [state, token] of [
        ['idleHovered', 'hoverBg'],
        ['idlePressed', 'pressedBg'],
      ] as const) {
        const chip = drawState(state, { theme });
        const name = `${state} ${theme}`;
        // The fill is the target's, seen through the name area, which has no ground of its own.
        expect(chip.target?.style.backgroundColor, name).toBe(written(color[theme][token]));
        expect(chip.name.style.backgroundColor, name).toBe('');
        expect(chip.tile.style.backgroundColor, name).toBe(written(issue['rent-housing'][theme]));
      }
    }
    const resting = drawState('idle');
    expect(resting.target?.style.backgroundColor).toBe('');
    expect(resting.target?.style.outlineStyle).toBe('');
    expect(drawState('idleFocused').target?.style.outlineStyle).toBe('solid');
    // An inverted chip keeps its ground under a pointer.
    cleanup();
    renderWithProviders(
      <InteractionPreview state={{ hovered: true }}>
        <IssueChip {...STATES.selected} />
      </InteractionPreview>,
    );
    const on = partsOf(STATES.selected.testID);
    expect(on.name.style.backgroundColor).toBe(written(color.light.selectedBg));
    expect(screen.getByText('Rent').style.color).toBe(written(color.light.selectedText));
  });

  it('the drawing lets a press through to the target under it', () => {
    const chip = drawState('idle');
    // The target is the chip's first layer and covers it; the drawing comes after and takes no press.
    expect(chip.root.firstElementChild).toBe(chip.target?.parentElement);
    expect(chip.target?.parentElement?.style.position).toBe('absolute');
    // The drawing is the one view of the chip told to take no press; a phone's screen reader skips it.
    const drawn = views.props.filter(
      (props) => props['pointerEvents'] === 'none' && props['aria-hidden'] === true,
    );
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.['style']).toMatchObject({ overflow: 'hidden', flexDirection: 'row' });
    expect(drawn[0]?.['accessibilityElementsHidden']).toBe(true);
    expect(drawn[0]?.['importantForAccessibility']).toBe('no-hide-descendants');
    // A display chip has no target, and its drawing is an ordinary view.
    drawState('displayMd');
    expect(
      views.props.some(
        (props) => props['pointerEvents'] === 'none' && props['aria-hidden'] === true,
      ),
    ).toBe(false);
  });

  it('the target is as high as the chip', () => {
    const chip = drawState('longName');
    const filler = chip.target?.firstElementChild as HTMLElement;
    // Before the chip is measured: the least height of a chip.
    expect(filler.style.height).toBe('44px');
    const measured = views.props.find((props) => typeof props['onLayout'] === 'function');
    act(() => {
      (measured?.['onLayout'] as (event: unknown) => void)({
        nativeEvent: { layout: { x: 0, y: 0, width: 167, height: 46 } },
      });
    });
    expect(
      (partsOf(STATES.longName.testID).target?.firstElementChild as HTMLElement).style.height,
    ).toBe('46px');
    // A display chip measures nothing.
    drawState('displayMd');
    expect(views.props.some((props) => typeof props['onLayout'] === 'function')).toBe(false);
  });

  it('a long name takes a second line', () => {
    drawState('longName');
    const name = texts.props.find((props) => props['children'] === STATES.longName.name);
    expect(name?.['numberOfLines']).toBe(2);
    // The chip grows with its name: its height is a least height, never a fixed one.
    const chip = partsOf(STATES.longName.testID);
    expect(chip.root.style.height).toBe('');
    expect(chip.box.style.height).toBe('');
    expect(chip.name.style.paddingTop).toBe('5px');
    expect(chip.name.style.paddingBottom).toBe('5px');
  });

  it('in a row it is as wide as its name, and in a grid cell it fills the cell', () => {
    const chip = draw();
    expect(chip.root.style.maxWidth).toBe('100%');
    // Nothing in it grows: on a phone a part that grows where its parent is as large as its
    // content is drawn as large as the room that parent was offered.
    expect(chip.root.style.flexGrow).toBe('');
    expect(chip.box.style.flexGrow).toBe('');
    expect(chip.name.style.flexGrow).toBe('');
    // A long name still wraps inside a chip that has reached its row's width.
    expect(chip.box.style.flexShrink).toBe('1');
    expect(chip.name.style.flexShrink).toBe('1');
    cleanup();
    renderWithProviders(
      <IssueGridChip issueId="rent-housing" name="Rent" onPress={() => undefined} testID={PROBE} />,
    );
    const cell = partsOf(PROBE);
    expect(cell.root.style.maxWidth).toBe('');
    expect(cell.root.style.flexGrow).toBe('1');
    expect(cell.root.style.flexShrink).toBe('1');
    expect(cell.box.style.flexGrow).toBe('1');
    expect(cell.name.style.flexGrow).toBe('1');
  });

  it('the drawing is as high as the chip by stretching, in a row and in a cell', () => {
    const star = { starred: false, onToggle: () => undefined, label: 'Star Rent' };
    for (const Drawn of [IssueChip, IssueGridChip]) {
      cleanup();
      renderWithProviders(
        <Drawn
          issueId="rent-housing"
          name="Rent"
          selected={true}
          star={star}
          onPress={() => undefined}
          testID={PROBE}
        />,
      );
      const chip = partsOf(PROBE);
      // The chip is a row and the drawing its one part in the flow: what grows, grows along the
      // width, and the height is the row's own stretch.
      expect(chip.root.style.flexDirection).toBe('row');
      expect(chip.box.style.alignSelf).toBe('');
      expect(chip.box.style.height).toBe('');
      const inFlow = ([...chip.root.children] as HTMLElement[]).filter(
        (part) => part.style.position !== 'absolute',
      );
      expect(inFlow).toEqual([chip.box]);
      // The outline covers the chip, so a chip its row stretches keeps one outline.
      expect(chip.outline.style.position).toBe('absolute');
      expect(chip.outline.parentElement).toBe(chip.root);
      for (const side of ['top', 'right', 'bottom', 'left'] as const) {
        expect(chip.outline.style[side], side).toBe('0px');
      }
    }
  });

  it('in a grid cell the name takes the lines it needs', () => {
    // At large text a selected chip's name can need a third line beside its star; a limit would
    // cut the name a person chooses by.
    const star = { starred: false, onToggle: () => undefined, label: 'Star Corporate subsidies' };
    texts.props.length = 0;
    renderWithProviders(
      <IssueGridChip
        issueId="corporate-subsidies"
        name="Corporate subsidies"
        selected={true}
        star={star}
        onPress={() => undefined}
        testID={PROBE}
      />,
      { textScale: 1.3 },
    );
    const inCell = texts.props.find((props) => props['children'] === 'Corporate subsidies');
    expect(inCell).toBeDefined();
    expect(inCell?.['numberOfLines']).toBeUndefined();
    const cell = partsOf(PROBE);
    expect(cell.root.style.height).toBe('');
    expect(cell.box.style.height).toBe('');
    cleanup();

    // The same chip in a row keeps to two lines.
    texts.props.length = 0;
    renderWithProviders(
      <IssueChip
        issueId="corporate-subsidies"
        name="Corporate subsidies"
        selected={true}
        star={star}
        onPress={() => undefined}
        testID={PROBE}
      />,
      { textScale: 1.3 },
    );
    const inRow = texts.props.find((props) => props['children'] === 'Corporate subsidies');
    expect(inRow?.['numberOfLines']).toBe(2);
  });

  it('never a pill', () => {
    for (const state of STATE_NAMES) {
      const chip = drawState(state);
      for (const part of [chip.root, ...chip.root.querySelectorAll<HTMLElement>('*')]) {
        expect(['', '0px', '4px'], state).toContain(part.style.borderRadius);
      }
    }
  });
});
