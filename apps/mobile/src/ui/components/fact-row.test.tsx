import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, rule, size, space } from '@/ui/tokens';

import { FactRow } from './fact-row';
import type { FactRowProps } from './fact-row';
import { GROUND, PREVIEW, STATES } from './fact-row.fixtures';

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
  'known',
  'about',
  'unknown',
  'pressable',
  'pressableUnknown',
  'longValue',
] as const;

const ALL: Readonly<Record<StateName, FactRowProps>> = STATES;

const COMPACT = [360, 740] as const;
const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const UNKNOWN = 'not known yet';
const CHEVRON = 'M9 5l7 7-7 7';

/** What a state shows for its value. */
const SHOWN: Readonly<Record<StateName, string>> = {
  known: '4 years',
  about: 'about $37.50',
  unknown: UNKNOWN,
  pressable: '4 years',
  pressableUnknown: UNKNOWN,
  longValue: 'Likely, with evening meetings',
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

/** Renders one row, in place of whatever was drawn before, and gives back the element with its id. */
function draw(props: FactRowProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<FactRow {...props} />, options);
  if (props.testID === undefined) {
    throw new Error('every fixture row has a testID');
  }
  return screen.getByTestId(props.testID);
}

/** The frame of a row: the element that carries the soft rule on its top edge. */
function frameOf(row: HTMLElement): HTMLElement {
  const frame = [row, ...row.querySelectorAll<HTMLElement>('*')].find(
    (part) => part.style.borderTopWidth === `${String(rule.hairline)}px`,
  );
  if (frame === undefined) {
    throw new Error('the row draws no rule');
  }
  return frame;
}

describe('FactRow', () => {
  it('renders every state', () => {
    setViewport(...COMPACT);
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const row = draw(ALL[state], { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const frame = frameOf(row);
          // A soft rule on the top edge and 12 points above and below the words.
          expect(frame.style.borderTopColor, name).toBe(written(color[theme].ruleSoft));
          expect(frame.style.paddingTop, name).toBe(`${String(space.x3)}px`);
          expect(frame.style.paddingBottom, name).toBe(`${String(space.x3)}px`);
          // The label in grey, the value in the text color.
          const label = within(row).getByText(ALL[state].label);
          expect(label.style.color, name).toBe(written(color[theme].textSecondary));
          const value = within(row).getByText(SHOWN[state]);
          expect(value.style.color, name).toBe(written(color[theme].text));
          // Never a dash and never a blank where the value is.
          expect(row.textContent, name).toBe(`${ALL[state].label} ${SHOWN[state]}`);
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the six states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.fact-row-${kebab(state)}`);
    }
    expect(STATES.known.value).toEqual({ text: '4 years', about: false });
    expect(STATES.about.value).toEqual({ text: '$37.50', about: true });
    expect(STATES.unknown.value).toEqual({ text: null, about: false });
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const row = draw(ALL[state]);
      if (ALL[state].onPress === undefined) {
        // Read as text: the label, then the value.
        expect(row.getAttribute('role'), state).toBeNull();
        expect(row.getAttribute('aria-label'), state).toBeNull();
        expect(screen.queryAllByRole('button'), state).toHaveLength(0);
      } else {
        expect(row.getAttribute('role'), state).toBe('button');
        expect(row.getAttribute('aria-label'), state).toBe(`${ALL[state].label}: ${SHOWN[state]}`);
      }
    }
  });

  it('has a testID', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const row = draw(ALL[state]);
      expect(row.getAttribute('data-testid'), state).toMatch(TEST_ID);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(1);
    }
  });

  it('respects reduced motion', () => {
    setViewport(...COMPACT);
    // A row cuts to its fill and never moves, with reduced motion or without it.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const row = draw(ALL[state], { reducedMotion });
        fireEvent.keyDown(row, { key: 'Enter' });
        for (const part of [row, ...row.querySelectorAll<HTMLElement>('*')]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
        }
        fireEvent.keyUp(row, { key: 'Enter' });
      }
    }
  });

  it('shows not known yet', () => {
    setViewport(...COMPACT);
    for (const theme of ['light', 'dark'] as const) {
      const row = draw({ ...STATES.unknown, value: { text: null, about: false } }, { theme });
      const words = within(row).getByText(UNKNOWN);
      // The unknown tag: a dashed hairline box, at full contrast.
      expect(words.parentElement?.style.borderStyle).toBe('dashed');
      expect(words.style.color).toBe(written(color[theme].text));
      for (const part of [row, ...row.querySelectorAll<HTMLElement>('*')]) {
        expect(part.style.opacity).toBe('');
      }
    }
    // An estimate says so.
    const row = draw({ ...STATES.known, value: { text: '4 years', about: true } });
    expect(within(row).getByText('about 4 years')).toBeTruthy();
    // An unknown value is never an estimate of nothing.
    const none = draw({ ...STATES.known, value: { text: null, about: true } });
    expect(none.textContent).toBe(`Term ${UNKNOWN}`);
  });

  it('estimate at full contrast', () => {
    setViewport(...COMPACT);
    for (const theme of ['light', 'dark'] as const) {
      const row = draw(STATES.about, { theme });
      const value = within(row).getByText('about $37.50');
      expect(value.style.color).toBe(written(color[theme].text));
      expect(value.style.fontStyle).toBe('');
      for (const part of [row, ...row.querySelectorAll<HTMLElement>('*')]) {
        expect(part.style.opacity).toBe('');
      }
      // The same weight as a value that is known.
      const known = within(draw(STATES.known, { theme })).getByText('4 years');
      expect(known.style.fontFamily).toBe(value.style.fontFamily);
    }
  });

  it('pressable row', () => {
    setViewport(...COMPACT);
    const onPress = vi.fn();
    const row = draw({ ...STATES.pressable, onPress });
    expect(screen.getByRole('button', { name: 'Term: 4 years' })).toBe(row);
    // One target, at least 44 points high, with a chevron at its end.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(frameOf(row).style.minHeight).toBe(`${String(size.target)}px`);
    expect(row.querySelector('path')?.getAttribute('d')).toBe(CHEVRON);
    fireEvent.click(row);
    expect(onPress).toHaveBeenCalledTimes(1);
    // A row that only shows a fact has no chevron.
    expect(draw(STATES.known).querySelector('svg')).toBeNull();
    // The name says so when the value is not known.
    const unknown = draw(STATES.pressableUnknown);
    expect(screen.getByRole('button', { name: 'Hours: not known yet' })).toBe(unknown);
    // And says "about" before an estimate.
    draw({ ...STATES.pressable, value: { text: '$37.50', about: true } });
    expect(screen.getByRole('button', { name: 'Term: about $37.50' })).toBeTruthy();
  });

  it('stacks at large text', () => {
    setViewport(...COMPACT);
    const side = draw(STATES.longValue);
    const sideLine = within(side).getByText(STATES.longValue.label).parentElement?.parentElement;
    expect(sideLine?.style.flexDirection).toBe('row');
    expect(within(side).getByText(SHOWN.longValue).style.textAlign).toBe('right');
    const stacked = draw(STATES.longValue, { textScale: 1.3 });
    const line = within(stacked).getByText(STATES.longValue.label).parentElement?.parentElement;
    // The value goes under its label, from the left edge.
    expect(line?.style.flexDirection).not.toBe('row');
    expect(line?.style.rowGap).toBe(`${String(space.x1)}px`);
    expect(within(stacked).getByText(SHOWN.longValue).style.textAlign).toBe('left');
    expect([...(line?.children ?? [])].map((part) => part.textContent)).toEqual([
      STATES.longValue.label,
      ' ',
      SHOWN.longValue,
    ]);
  });

  it('the label and the value read as separate words, in the order of its name', () => {
    setViewport(...COMPACT);
    // The words of a text: letters and digits, apart at anything else.
    const words = (text: string | null): string[] =>
      (text ?? '')
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word !== '');
    for (const scale of [1, 1.3]) {
      for (const state of STATE_NAMES) {
        const name = `${state} ${String(scale)}`;
        const row = draw(ALL[state], { textScale: scale });
        expect(row.textContent, name).toBe(`${ALL[state].label} ${SHOWN[state]}`);
        if (ALL[state].onPress !== undefined) {
          // A pressable row's name holds the words it shows, one after another.
          expect(words(row.getAttribute('aria-label')), name).toEqual(words(row.textContent));
        }
        // The space is out of the row's layout and hidden from a screen reader.
        const spaces = [...row.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].filter(
          (part) => part.textContent === ' ',
        );
        expect(spaces, name).toHaveLength(1);
        expect(spaces[0]?.parentElement?.style.position, name).toBe('absolute');
      }
    }
  });

  it('a pressable row needs a testID', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    cleanup();
    expect(() => {
      renderWithProviders(
        <FactRow
          label="Term"
          value={{ text: '4 years', about: false }}
          onPress={() => undefined}
        />,
      );
    }).toThrow('A pressable fact row needs a testID.');
    errors.mockRestore();
  });
});
