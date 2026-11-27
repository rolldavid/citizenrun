import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { clearOncePerItem, motion } from '@/ui/motion';
import type * as Motion from '@/ui/motion';
import { color, opacity, size, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';
import type { TypeRole } from '@/ui/typography';

import { DeadlineBlock } from './deadline-block';
import type { DeadlineBlockProps } from './deadline-block';
import { GROUND, PREVIEW, STATES } from './deadline-block.fixtures';

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

// What the flag dip is told on each render, so a case can read whether the block asked for it.
const dips = vi.hoisted(() => {
  const state: { plays: boolean[] } = { plays: [] };
  return state;
});

vi.mock('@/ui/motion', async (importOriginal) => {
  const actual = await importOriginal<typeof Motion>();
  return {
    ...actual,
    useDip: (play: boolean): ReturnType<typeof actual.useDip> => {
      dips.plays.push(play);
      return actual.useDip(play);
    },
  };
});

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'open',
  'openSoon',
  'notOpen',
  'closed',
  'unknown',
  'conflict',
  'withMotion',
] as const;

const ALL: Readonly<Record<StateName, DeadlineBlockProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const CAUTION = 'Confirm with your election office.';
const UNKNOWN = 'not known yet';
/** Longer than a frame, so the frame after the first one has been drawn. */
const A_FRAME_MS = 40;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one block, in place of whatever was drawn before, and gives back the element with its id. */
function draw(props: DeadlineBlockProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  dips.plays.length = 0;
  renderWithProviders(<DeadlineBlock {...props} />, options);
  return screen.getByTestId(props.testID);
}

/** The ring of a block: the hidden box that holds the thirty ticks and the count. */
function ringOf(block: HTMLElement): HTMLElement | null {
  return (
    [...block.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].find(
      (part) => part.children.length === size.ring.ticks + 1,
    ) ?? null
  );
}

/** How many ticks of a ring are lit. */
function litOf(ring: HTMLElement): number {
  return [...ring.children].filter(
    (tick) => tick instanceof HTMLElement && tick.style.backgroundColor !== '',
  ).length;
}

/** The words a state draws in place of its headline: the flag, where the window closes soon. */
function leadOf(props: DeadlineBlockProps): string {
  const flagged =
    props.state === 'open' &&
    props.daysLeft !== null &&
    props.daysLeft <= 7 &&
    props.flagLabel !== null;
  return flagged ? (props.flagLabel ?? '') : props.headline;
}

/** Expects `words` to be set in `role` at `scale`. */
function expectRole(words: HTMLElement, role: TypeRole, scale: number, name: string): void {
  const style = typography[role].style;
  expect(words.style.fontFamily, name).toContain(String(style.fontFamily));
  expect(parseFloat(words.style.fontSize), name).toBeCloseTo((style.fontSize ?? 0) * scale);
}

/** True when `earlier` comes before `later` in the page. */
function precedes(earlier: Element, later: Element): boolean {
  return (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

afterEach(() => {
  vi.useRealTimers();
  clearOncePerItem();
});

describe('DeadlineBlock', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const props = ALL[state];
          const block = draw(props, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          // The headline, or the flag in its place, then every line, in the text color.
          expect(within(block).getByText(leadOf(props)), name).toBeDefined();
          for (const line of props.lines) {
            const words = within(block).getByText(line);
            expectRole(words, 'body', scale, name);
            expect(words.style.color, name).toBe(written(color[theme].text));
          }
          const caution = within(block).getByText(props.caution);
          expectRole(caution, 'label', scale, name);
          expect(caution.style.color, name).toBe(written(color[theme].text));
          // A ring exactly when the window is open, at its smallest size whatever the text size.
          const ring = ringOf(block);
          expect(ring !== null, name).toBe(props.state === 'open');
          if (ring !== null) {
            expect(ring.style.width, name).toBe(`${String(size.deadlineRingMin)}px`);
            expect(litOf(ring), name).toBe(props.daysLeft);
          }
        }
      }
    }
    cleanup();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the seven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.deadline-block-${kebab(state)}`);
      expect(ALL[state].caution, state).toBe(CAUTION);
    }
    expect(STATES.open).toMatchObject({ state: 'open', daysLeft: 12, flagLabel: null });
    expect(STATES.open.lines).toEqual([
      'Closes Fri, Nov 27, 2026 at 5:00 pm Pacific.',
      'File in person at the county clerk.',
    ]);
    expect(STATES.open.source.confidence).toBe('medium');
    expect(STATES.openSoon).toMatchObject({ daysLeft: 5, flagLabel: '5 days to file' });
    expect(STATES.notOpen).toMatchObject({ state: 'not_open', headline: 'Filing opens in 9 days' });
    expect(STATES.notOpen.lines).toEqual(['Opens Mon, Nov 23, 2026.']);
    expect(STATES.closed).toMatchObject({ state: 'closed', headline: 'Filing closed' });
    expect(STATES.closed.lines).toEqual(['Closed Fri, Nov 6, 2026.']);
    expect(STATES.unknown).toMatchObject({
      state: 'unknown',
      headline: 'Filing deadline not known yet',
      source: null,
    });
    expect(STATES.conflict.conflict).toBe(
      'Two closing dates are listed: Fri, Nov 27 and Mon, Nov 30. The earlier one is shown.',
    );
    expect(STATES.withMotion).toMatchObject({ daysLeft: 5, itemKey: 'fixture-deadline-block' });
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const props = ALL[state];
      const block = draw(props);
      // The block is read as text, in order; its one control is the source row.
      expect(block.getAttribute('role'), state).toBeNull();
      expect(block.getAttribute('aria-label'), state).toBeNull();
      const buttons = within(block).queryAllByRole('button');
      if (props.source === null) {
        expect(buttons, state).toHaveLength(0);
      } else {
        expect(buttons, state).toHaveLength(1);
        expect(buttons[0]?.getAttribute('aria-label'), state).toBe(
          `Medium confidence. ${props.source.text}`,
        );
      }
      // The words beside the ring say the days: they are never hidden with it.
      const lead = within(block).getByText(leadOf(props));
      expect(lead.closest('[aria-hidden="true"]'), state).toBeNull();
      expect(within(block).getByText(props.caution).closest('[aria-hidden="true"]'), state).toBe(
        null,
      );
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const props = ALL[state];
      const block = draw(props);
      expect(block.getAttribute('data-testid'), state).toMatch(TEST_ID);
      const ids = [...document.querySelectorAll('[data-testid]')].map((part) =>
        part.getAttribute('data-testid'),
      );
      // The block's id, then its source row's.
      expect(ids, state).toEqual(
        props.source === null ? [props.testID] : [props.testID, props.source.testID],
      );
      for (const id of ids) {
        expect(id, state).toMatch(TEST_ID);
      }
    }
  });

  it('respects reduced motion', () => {
    vi.useFakeTimers();
    for (const state of STATE_NAMES) {
      clearOncePerItem();
      const props = ALL[state];
      const block = draw(props, { reducedMotion: true });
      act(() => {
        vi.advanceTimersByTime(motion.duration.flagDip + A_FRAME_MS);
      });
      // Nothing moves and nothing is left faint: the flag does not dip, and the ticks are all on.
      const ring = ringOf(block);
      for (const part of block.querySelectorAll<HTMLElement>('*')) {
        if (ring?.contains(part) === true && part !== ring) continue;
        expect(part.style.transform, state).toBe('');
        expect(part.style.animationName, state).toBe('');
        expect(part.style.opacity === '' || part.style.opacity === '1', state).toBe(true);
      }
      if (ring !== null) {
        for (const tick of ring.children) {
          if (!(tick instanceof HTMLElement)) continue;
          expect(tick.style.opacity === '' || tick.style.opacity === '1', state).toBe(true);
        }
      }
    }
  });

  it('shows not known yet', () => {
    for (const theme of ['light', 'dark'] as const) {
      const block = draw(STATES.unknown, { theme });
      // The headline and the tag say it in words, at full contrast: never a dash, never a blank.
      const headline = within(block).getByText('Filing deadline not known yet');
      const tag = within(block).getByText(UNKNOWN);
      expect(headline.style.color, theme).toBe(written(color[theme].text));
      expect(tag.style.color, theme).toBe(written(color[theme].text));
      expect(block.textContent, theme).toBe(`Filing deadline not known yet${UNKNOWN}${CAUTION}`);
      for (const part of block.querySelectorAll<HTMLElement>('*')) {
        expect(part.style.opacity, theme).toBe('');
      }
    }
  });

  it('the caution in every state', () => {
    for (const state of STATE_NAMES) {
      const block = draw(ALL[state]);
      const caution = within(block).getByText(CAUTION);
      // The last thing the block says, in every state.
      expect(block.textContent.endsWith(CAUTION), state).toBe(true);
      expect(caution.style.color, state).toBe(written(color.light.text));
    }
    // It is the caller's sentence, drawn whatever the state.
    for (const state of ['unknown', 'not_open', 'closed'] as const) {
      const block = draw({
        ...STATES.notOpen,
        state,
        caution: 'Confirm with the county clerk before you file.',
      });
      expect(
        within(block).getByText('Confirm with the county clerk before you file.'),
        state,
      ).toBeDefined();
    }
  });

  it('open draws the ring', () => {
    const block = draw(STATES.open);
    const ring = ringOf(block);
    if (ring === null) {
      throw new Error('an open block draws no ring');
    }
    expect(litOf(ring)).toBe(12);
    const headline = within(block).getByText('12 days left to file');
    expectRole(headline, 'heading', 1, 'headline');
    const closes = within(block).getByText('Closes Fri, Nov 27, 2026 at 5:00 pm Pacific.');
    const where = within(block).getByText('File in person at the county clerk.');
    const source = screen.getByTestId(STATES.open.source.testID);
    const caution = within(block).getByText(CAUTION);
    // The ring, the words beside it 16 points away, then the source row and the caution under them.
    expect(ring.parentElement?.style.flexDirection).toBe('row');
    expect(ring.parentElement?.style.columnGap).toBe(`${String(space.x4)}px`);
    expect(ring.parentElement?.contains(headline)).toBe(true);
    expect(ring.parentElement?.contains(source)).toBe(false);
    for (const [earlier, later] of [
      [ring, headline],
      [headline, closes],
      [closes, where],
      [where, source],
      [source, caution],
    ] as const) {
      expect(precedes(earlier, later)).toBe(true);
    }
    expect(source.textContent).toContain(STATES.open.source.text);
    // Twelve days is not soon: no flag.
    expect(within(block).queryByText('5 days to file')).toBeNull();
  });

  it('a flag with the date at seven days or fewer', () => {
    const block = draw(STATES.openSoon);
    const flag = within(block).getByText('5 days to file');
    const closes = within(block).getByText('Closes Fri, Nov 20, 2026 at 5:00 pm Pacific.');
    // The flag stands where the headline would, and the closing date follows it.
    expect(flag.parentElement?.style.backgroundColor).toBe(written(color.light.highlight));
    expect(precedes(flag, closes)).toBe(true);
    expect(within(block).queryByText('5 days left to file')).toBeNull();
    const ring = ringOf(block);
    expect(ring === null ? null : litOf(ring)).toBe(5);
    expect(ring?.parentElement?.contains(flag)).toBe(true);

    // Seven days is soon; eight is not. Without a flag label the headline stays.
    const seven = draw({ ...STATES.openSoon, daysLeft: 7, flagLabel: '7 days to file' });
    expect(within(seven).getByText('7 days to file')).toBeDefined();
    expect(within(seven).queryByText('5 days left to file')).toBeNull();
    const eight = draw({ ...STATES.openSoon, daysLeft: 8, flagLabel: '8 days to file' });
    expect(within(eight).queryByText('8 days to file')).toBeNull();
    expect(within(eight).getByText('5 days left to file')).toBeDefined();
    const unlabelled = draw({ ...STATES.openSoon, flagLabel: null });
    expect(within(unlabelled).getByText('5 days left to file')).toBeDefined();
    // A window that is not open never flags, whatever it is handed.
    const closed = draw({ ...STATES.closed, daysLeft: 3, flagLabel: '3 days to file' });
    expect(within(closed).queryByText('3 days to file')).toBeNull();
    expect(within(closed).getByText('Filing closed')).toBeDefined();
  });

  it('no ring when not open or closed', () => {
    for (const state of ['notOpen', 'closed'] as const) {
      const props = ALL[state];
      const block = draw(props);
      expect(ringOf(block), state).toBeNull();
      const headline = within(block).getByText(props.headline);
      expectRole(headline, 'heading', 1, state);
      const line = within(block).getByText(props.lines[0] ?? '');
      const source = screen.getByTestId(props.source?.testID ?? '');
      const caution = within(block).getByText(CAUTION);
      expect(precedes(headline, line), state).toBe(true);
      expect(precedes(line, source), state).toBe(true);
      expect(precedes(source, caution), state).toBe(true);
    }
  });

  it('unknown has no source row', () => {
    const block = draw(STATES.unknown);
    const headline = within(block).getByText('Filing deadline not known yet');
    const tag = within(block).getByText(UNKNOWN);
    const caution = within(block).getByText(CAUTION);
    expectRole(headline, 'heading', 1, 'headline');
    expect(precedes(headline, tag)).toBe(true);
    expect(precedes(tag, caution)).toBe(true);
    expect(ringOf(block)).toBeNull();
    expect(within(block).queryAllByRole('button')).toHaveLength(0);
    expect(block.querySelectorAll('svg')).toHaveLength(0);
    // A window nobody knows has no date to say, whatever lines it is handed.
    const withLines = draw({ ...STATES.unknown, lines: ['Closes Fri, Nov 27, 2026.'] });
    expect(within(withLines).queryByText('Closes Fri, Nov 27, 2026.')).toBeNull();
  });

  it('conflict notice above', () => {
    const block = draw(STATES.conflict);
    const notice = within(block).getByRole('alert');
    expect(notice.textContent).toBe(
      'Two closing dates are listed: Fri, Nov 27 and Mon, Nov 30. The earlier one is shown.',
    );
    const ring = ringOf(block);
    if (ring === null) {
      throw new Error('the conflict state draws no ring');
    }
    // First in the block, before the ring and the headline.
    expect(block.firstElementChild?.contains(notice)).toBe(true);
    expect(precedes(notice, ring)).toBe(true);
    expect(precedes(notice, within(block).getByText('12 days left to file'))).toBe(true);
    // No conflict, no notice.
    expect(within(draw(STATES.open)).queryByRole('alert')).toBeNull();
    expect(within(draw({ ...STATES.open, conflict: null })).queryByRole('alert')).toBeNull();
  });

  it('a missing source throws', () => {
    // React reports the throw on the console as well; the case reads the throw itself.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => draw({ ...STATES.open, source: null })).toThrow(/needs its source/);
    expect(() => draw({ ...STATES.notOpen, source: null })).toThrow(/needs its source/);
    expect(() => draw({ ...STATES.closed, source: null })).toThrow(/needs its source/);
    // An open window with no days left to say cannot draw its ring.
    expect(() => draw({ ...STATES.open, daysLeft: null })).toThrow(/needs its days left/);
    errors.mockRestore();
    // Only a window nobody knows has no source.
    expect(() => draw(STATES.unknown)).not.toThrow();
  });

  it('the flag dips once beside the ring', () => {
    vi.useFakeTimers();
    clearOncePerItem();
    const first = draw(STATES.withMotion);
    const flag = within(first).getByText('5 days to file');
    // The flag is drawn whole first; the frame after, the dip is asked for, as the ticks cut on.
    expect(dips.plays.every((play) => !play)).toBe(true);
    const ring = ringOf(first);
    expect(
      ring?.firstElementChild instanceof HTMLElement && ring.firstElementChild.style.opacity,
    ).toBe('0');
    act(() => {
      vi.advanceTimersByTime(A_FRAME_MS);
    });
    expect(dips.plays.at(-1)).toBe(true);
    // It goes down to the low point and comes back whole, and the words never leave.
    const seen: number[] = [];
    const dipped = flag.parentElement?.parentElement;
    for (let elapsed = 0; elapsed < motion.duration.flagDip + A_FRAME_MS; elapsed += 10) {
      act(() => {
        vi.advanceTimersByTime(10);
      });
      seen.push(
        dipped === null || dipped === undefined || dipped.style.opacity === ''
          ? 1
          : Number(dipped.style.opacity),
      );
    }
    expect(Math.min(...seen)).toBeCloseTo(opacity.skeletonLow, 5);
    expect(seen.at(-1)).toBe(1);
    expect(flag.textContent).toBe('5 days to file');

    // The same item again: no dip is asked for, and the ticks are drawn whole.
    const second = draw(STATES.withMotion);
    act(() => {
      vi.advanceTimersByTime(motion.duration.flagDip + A_FRAME_MS);
    });
    expect(dips.plays.length).toBeGreaterThan(0);
    expect(dips.plays.every((play) => !play)).toBe(true);
    const again = ringOf(second);
    expect(
      again?.firstElementChild instanceof HTMLElement && again.firstElementChild.style.opacity,
    ).toBe('');

    // No key, no dip.
    clearOncePerItem();
    draw(STATES.openSoon);
    act(() => {
      vi.advanceTimersByTime(motion.duration.flagDip + A_FRAME_MS);
    });
    expect(dips.plays.every((play) => !play)).toBe(true);
  });

  it('the source row opens the sources', () => {
    const onPress = vi.fn();
    const block = draw({ ...STATES.open, source: { ...STATES.open.source, onPress } });
    fireEvent.click(within(block).getByRole('button'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
