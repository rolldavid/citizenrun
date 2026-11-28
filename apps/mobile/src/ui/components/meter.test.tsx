import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { clearOncePerItem, motion } from '@/ui/motion';
import { color, rule, size, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';

import { Meter } from './meter';
import type { MeterProps } from './meter';
import { GROUND, PREVIEW, STATES } from './meter.fixtures';

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
  'feedKnown',
  'unknown',
  'about',
  'feedZero',
  'feedFull',
  'pageKnown',
  'pageExpanded',
  'pageUnknown',
  'withMotion',
] as const;

const ALL: Readonly<Record<StateName, MeterProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const UNKNOWN = 'not known yet';
const CHEVRON_RIGHT = 'M9 5l7 7-7 7';
const CHEVRON_DOWN = 'M5 9l7 7 7-7';
/** Two frames: a timed run lands on the first frame at or after its end. */
const FRAME_SLACK_MS = 40;

/** The pips each state lights and the name a screen reader hears. */
const EXPECTED: Readonly<Record<StateName, { lit: number; label: string }>> = {
  feedKnown: { lit: 7, label: 'Ease: Easier than most. 7 of 10.' },
  unknown: { lit: 0, label: 'Ease: not known yet. 0 of 10.' },
  about: { lit: 7, label: 'Ease: About: easier than most. 7 of 10.' },
  feedZero: { lit: 0, label: 'Ease: Harder than most. 0 of 10.' },
  feedFull: { lit: 10, label: 'Ease: Easier than most. 10 of 10.' },
  pageKnown: { lit: 5, label: 'Impact: Medium on Property taxes. 5 of 10.' },
  pageExpanded: { lit: 5, label: 'Impact: Medium on Property taxes. 5 of 10.' },
  pageUnknown: { lit: 0, label: 'Impact: not known yet. 0 of 10.' },
  withMotion: { lit: 7, label: 'Ease: Easier than most. 7 of 10.' },
};

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one meter, in place of whatever was drawn before, and gives back its target. */
function draw(props: MeterProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<Meter {...props} />, options);
  return screen.getByTestId(props.testID);
}

/** The ten pips of a meter, left to right. */
function pipsOf(meter: HTMLElement): HTMLElement[] {
  const row = [...meter.querySelectorAll<HTMLElement>('*')].find(
    (part) =>
      part.children.length === size.meterPips &&
      part.style.flexDirection === 'row' &&
      part.style.columnGap === `${String(space.pip)}px`,
  );
  if (row === undefined) {
    throw new Error('the meter draws no row of pips');
  }
  return [...row.children].filter((pip): pip is HTMLElement => pip instanceof HTMLElement);
}

function isLit(pip: HTMLElement): boolean {
  return pip.style.backgroundColor !== '';
}

/** How many pips a meter with this score lights. */
function litFor(score: number | null, form: MeterProps['form']): number {
  const meter = draw({
    form,
    name: 'Ease',
    score,
    phrase: score === null ? null : 'Easier than most',
    onPress: () => undefined,
    testID: 'fixture.meter',
  });
  return pipsOf(meter).filter(isLit).length;
}

/** The opacity a pip is drawn at; a pip with none set is whole. */
function opacityOf(pip: HTMLElement): number {
  return pip.style.opacity === '' ? 1 : Number(pip.style.opacity);
}

afterEach(() => {
  vi.useRealTimers();
  clearOncePerItem();
});

describe('Meter', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const props = ALL[state];
          const meter = draw(props, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const pips = pipsOf(meter);
          expect(pips, name).toHaveLength(size.meterPips);
          expect(pips.filter(isLit), name).toHaveLength(EXPECTED[state].lit);
          const height = props.form === 'feed' ? size.meterPipFeed : size.meterPipPage;
          pips.forEach((pip, index) => {
            expect(pip.style.height, name).toBe(`${String(height)}px`);
            expect(pip.style.flexGrow, name).toBe('1');
            if (index < EXPECTED[state].lit) {
              // Lit: solid, in the text color.
              expect(pip.style.backgroundColor, name).toBe(written(color[theme].text));
              expect(pip.style.borderTopWidth, name).toBe('');
            } else {
              // Unlit: a solid hairline outline, never dashed and never faded.
              expect(pip.style.borderTopWidth, name).toBe(`${String(rule.hairline)}px`);
              expect(pip.style.borderTopColor, name).toBe(written(color[theme].textSecondary));
              expect(pip.style.borderTopStyle, name).not.toBe('dashed');
              expect(pip.style.borderTopStyle, name).not.toBe('dotted');
              expect(pip.style.opacity, name).toBe('');
            }
          });
          // The name in mono capitals, the phrase in words; no numeral anywhere.
          const title = within(meter).getByText(props.name);
          expect(title.style.fontFamily, name).toContain('ChivoMono');
          expect(title.style.textTransform, name).toBe('uppercase');
          const phrase = within(meter).getByText(props.phrase ?? UNKNOWN);
          expect(phrase.style.fontFamily, name).toContain(
            String(typography.label.style.fontFamily),
          );
          expect(parseFloat(phrase.style.fontSize), name).toBeCloseTo(
            (typography.label.style.fontSize ?? 0) * scale,
          );
          expect(phrase.style.color, name).toBe(written(color[theme].text));
          expect(meter.textContent, name).not.toMatch(/\d/);
        }
      }
    }
    cleanup();
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the nine states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.meter-${kebab(state)}`);
    }
    expect(STATES.feedKnown).toMatchObject({ form: 'feed', name: 'Ease', score: 72 });
    expect(STATES.unknown).toMatchObject({ form: 'feed', score: null, phrase: null });
    expect(STATES.about.phrase).toBe('About: easier than most');
    expect(STATES.feedZero.score).toBe(0);
    expect(STATES.feedFull.score).toBe(100);
    expect(STATES.pageKnown).toMatchObject({ form: 'page', name: 'Impact', score: 45 });
    expect(STATES.pageExpanded.expanded).toBe(true);
    expect(STATES.pageUnknown).toMatchObject({ form: 'page', score: null, phrase: null });
    expect(STATES.withMotion.itemKey).toBe('fixture-meter');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const meter = draw(ALL[state]);
      // The whole meter is one target with one name.
      expect(screen.getAllByRole('button'), state).toEqual([meter]);
      expect(meter.getAttribute('aria-label'), state).toBe(EXPECTED[state].label);
      // At least as high as the smallest target.
      expect(
        [meter, ...meter.querySelectorAll<HTMLElement>('*')].some(
          (part) => part.style.minHeight === `${String(size.target)}px`,
        ),
        state,
      ).toBe(true);
    }
    const onPress = vi.fn();
    const pressed = draw({ ...STATES.feedKnown, onPress });
    fireEvent.click(pressed);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const meter = draw(ALL[state]);
      expect(meter.getAttribute('data-testid'), state).toMatch(TEST_ID);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(1);
    }
  });

  it('respects reduced motion', () => {
    vi.useFakeTimers();
    // A meter that is not seen for the first time is still, with reduced motion or without.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        if (state === 'withMotion') continue;
        const meter = draw(ALL[state], { reducedMotion });
        for (const part of meter.querySelectorAll<HTMLElement>('*')) {
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
          expect(part.style.opacity, state).toBe('');
        }
        for (const pip of pipsOf(meter)) {
          expect(pip.style.transform, state).toBe('');
        }
      }
    }

    // Seen for the first time under reduced motion, the lit pips fade in together: no pip waits its turn.
    clearOncePerItem();
    const reduced = pipsOf(draw(STATES.withMotion, { reducedMotion: true }));
    act(() => {
      vi.advanceTimersByTime(motion.duration.pipStagger + FRAME_SLACK_MS);
    });
    const together = reduced.filter(isLit).map(opacityOf);
    expect(together).toHaveLength(EXPECTED.withMotion.lit);
    expect(new Set(together).size).toBe(1);
    expect(together[0]).toBeGreaterThan(0);
    for (const pip of reduced) {
      expect(pip.style.transform).toBe('');
    }
    act(() => {
      vi.advanceTimersByTime(motion.duration.pipStagger * size.meterPips);
    });
    expect(reduced.map(opacityOf)).toEqual(reduced.map(() => 1));
  });

  it('shows not known yet', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const state of ['unknown', 'pageUnknown'] as const) {
        const meter = draw(ALL[state], { theme });
        const name = `${state} ${theme}`;
        // The words, at full contrast, and the whole scale as outlines: nothing is faded or dashed.
        const words = within(meter).getByText(UNKNOWN);
        expect(words.style.color, name).toBe(written(color[theme].text));
        expect(words.style.opacity, name).toBe('');
        expect(pipsOf(meter).filter(isLit), name).toHaveLength(0);
        expect(meter.getAttribute('aria-label'), name).toBe(EXPECTED[state].label);
      }
    }
    // A phrase without a score is never shown as if the score were known.
    const meter = draw({ ...STATES.unknown, phrase: 'Easier than most' });
    expect(within(meter).getByText(UNKNOWN)).toBeDefined();
    expect(within(meter).queryByText('Easier than most')).toBeNull();
  });

  it('lit pips', () => {
    for (const form of ['feed', 'page'] as const) {
      expect(litFor(72, form), form).toBe(7);
      expect(litFor(45, form), form).toBe(5);
      expect(litFor(0, form), form).toBe(0);
      expect(litFor(100, form), form).toBe(10);
      expect(litFor(null, form), form).toBe(0);
    }
    // A tenth of the score, half rounding away from zero, and never off either end of the scale.
    expect(litFor(44, 'feed')).toBe(4);
    expect(litFor(4, 'feed')).toBe(0);
    expect(litFor(5, 'feed')).toBe(1);
    expect(litFor(94.9, 'feed')).toBe(9);
    expect(litFor(95, 'feed')).toBe(10);
    expect(litFor(250, 'feed')).toBe(10);
    expect(litFor(-20, 'feed')).toBe(0);
    // The lit pips are the first ones: the scale fills from the left.
    const pips = pipsOf(draw(STATES.pageKnown));
    expect(pips.map(isLit)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it('name, phrase and count are the label', () => {
    expect(draw(STATES.feedKnown).getAttribute('aria-label')).toBe(
      'Ease: Easier than most. 7 of 10.',
    );
    expect(draw(STATES.pageKnown).getAttribute('aria-label')).toBe(
      'Impact: Medium on Property taxes. 5 of 10.',
    );
    // Low confidence changes the phrase alone: the count is the same.
    expect(draw(STATES.about).getAttribute('aria-label')).toBe(
      'Ease: About: easier than most. 7 of 10.',
    );
  });

  it('unknown says not known yet', () => {
    const meter = draw(STATES.unknown);
    const pips = pipsOf(meter);
    expect(pips).toHaveLength(10);
    expect(pips.filter(isLit)).toHaveLength(0);
    for (const pip of pips) {
      expect(pip.style.borderTopWidth).toBe(`${String(rule.hairline)}px`);
    }
    expect(within(meter).getByText(UNKNOWN)).toBeDefined();
    expect(meter.textContent).toBe(`Ease ${UNKNOWN}`);
  });

  it('the name and the phrase read as separate words, in the order of its label', () => {
    // The words of a text: letters and digits, apart at anything else.
    const words = (text: string | null): string[] =>
      (text ?? '')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word !== '');
    for (const [state, props] of Object.entries(ALL)) {
      const meter = draw(props);
      const phrase = props.score === null || props.phrase === null ? UNKNOWN : props.phrase;
      expect(meter.textContent, state).toBe(`${props.name} ${phrase}`);
      // The label holds the words the meter shows, one after another, then the count.
      const shown = words(meter.textContent);
      const label = words(meter.getAttribute('aria-label'));
      expect(label.slice(0, shown.length), state).toEqual(shown);
      expect(label.slice(shown.length), state).toEqual([
        String(pipsOf(meter).filter(isLit).length),
        'of',
        '10',
      ]);
      // The space is out of the meter's layout and hidden from a screen reader.
      const spaces = [...meter.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].filter(
        (part) => part.textContent === ' ',
      );
      expect(spaces, state).toHaveLength(1);
      expect(spaces[0]?.parentElement?.style.position, state).toBe('absolute');
    }
  });

  it('page form expands', () => {
    const expanded = draw(STATES.pageExpanded);
    expect(expanded.getAttribute('aria-expanded')).toBe('true');
    expect(expanded.querySelector('path')?.getAttribute('d')).toBe(CHEVRON_DOWN);
    expect(expanded.querySelectorAll('path')).toHaveLength(1);

    const closed = draw(STATES.pageKnown);
    expect(closed.getAttribute('aria-expanded')).toBe('false');
    expect(closed.querySelector('path')?.getAttribute('d')).toBe(CHEVRON_RIGHT);

    // The feed form opens a page: it has nothing to expand.
    const feed = draw(STATES.feedKnown);
    expect(feed.getAttribute('aria-expanded')).toBeNull();
    expect(feed.querySelector('path')?.getAttribute('d')).toBe(CHEVRON_RIGHT);

    const onPress = vi.fn();
    fireEvent.click(draw({ ...STATES.pageKnown, onPress }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('only lit pips animate, once', () => {
    vi.useFakeTimers();
    clearOncePerItem();
    const first = pipsOf(draw(STATES.withMotion));
    const lit = EXPECTED.withMotion.lit;
    // The lit pips start off; the unlit ones carry no motion at all.
    first.forEach((pip, index) => {
      expect(pip.style.opacity, String(index)).toBe(index < lit ? '0' : '');
    });
    // They cut on from the left, one every 40 ms: the first is on while the last still waits.
    act(() => {
      vi.advanceTimersByTime(motion.duration.pipStagger + FRAME_SLACK_MS);
    });
    expect(opacityOf(first[0] as HTMLElement)).toBe(1);
    expect(opacityOf(first[lit - 1] as HTMLElement)).toBe(0);
    act(() => {
      vi.advanceTimersByTime(motion.duration.pipStagger * size.meterPips + FRAME_SLACK_MS);
    });
    expect(first.map(opacityOf)).toEqual(first.map(() => 1));
    expect(first.filter(isLit)).toHaveLength(lit);

    // The same item again is drawn whole at once.
    const second = pipsOf(draw(STATES.withMotion));
    for (const pip of second) {
      expect(pip.style.opacity).toBe('');
    }
    expect(second.filter(isLit)).toHaveLength(lit);

    // A meter with nothing lit plays nothing and does not use the item's one play up.
    clearOncePerItem();
    for (const pip of pipsOf(draw({ ...STATES.unknown, itemKey: 'fixture-meter' }))) {
      expect(pip.style.opacity).toBe('');
    }
    const later = pipsOf(draw(STATES.withMotion));
    expect(later[0]?.style.opacity).toBe('0');
  });
});
