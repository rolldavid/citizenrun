import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, rule, space } from '@/ui/tokens';
import { typography } from '@/ui/typography';
import type { TypeRole } from '@/ui/typography';

import { MeterInputs } from './meter-inputs';
import type { MeterInputsProps } from './meter-inputs';
import { GROUND, PREVIEW, STATES } from './meter-inputs.fixtures';

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

const STATE_NAMES = ['known', 'unknown', 'knownNoSource', 'withSourceLink'] as const;

const ALL: Readonly<Record<StateName, MeterInputsProps>> = STATES;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const UNKNOWN = 'not known yet';

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one panel, in place of whatever was drawn before, and gives back the element with its id. */
function draw(props: MeterInputsProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<MeterInputs {...props} />, options);
  if (props.testID === undefined) {
    throw new Error('every fixture panel has a testID');
  }
  return screen.getByTestId(props.testID);
}

/** The rule down the left edge and the column of blocks beside it. */
function partsOf(panel: HTMLElement): { edge: HTMLElement; blocks: HTMLElement[] } {
  const [edge, column] = panel.children;
  if (!(edge instanceof HTMLElement) || !(column instanceof HTMLElement)) {
    throw new Error('the panel draws no edge and column');
  }
  return {
    edge,
    blocks: [...column.children].filter(
      (block): block is HTMLElement => block instanceof HTMLElement,
    ),
  };
}

/** Expects `words` to be set in `role` at `scale`. */
function expectRole(words: HTMLElement, role: TypeRole, scale: number, name: string): void {
  const style = typography[role].style;
  expect(words.style.fontFamily, name).toContain(String(style.fontFamily));
  expect(parseFloat(words.style.fontSize), name).toBeCloseTo((style.fontSize ?? 0) * scale);
}

describe('MeterInputs', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const props = ALL[state];
          const panel = draw(props, { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          const { edge, blocks } = partsOf(panel);
          // A rule down the left edge, then the blocks 12 points from it and from each other.
          expect(panel.style.flexDirection, name).toBe('row');
          expect(edge.style.width, name).toBe(`${String(rule.panel)}px`);
          expect(edge.style.backgroundColor, name).toBe(written(color[theme].rule));
          expect(blocks[0]?.parentElement?.style.marginLeft, name).toBe(`${String(space.x3)}px`);
          expect(blocks[0]?.parentElement?.style.rowGap, name).toBe(`${String(space.x3)}px`);
          expect(blocks, name).toHaveLength(
            props.inputs.length + (props.sourceLink === undefined ? 0 : 1),
          );
          props.inputs.forEach((input, index) => {
            const block = blocks[index] as HTMLElement;
            if (input.sentence === null) {
              const label = within(block).getByText(input.unknownLabel);
              expectRole(label, 'body', scale, name);
              expect(label.style.color, name).toBe(written(color[theme].text));
              expect(within(block).getByText(UNKNOWN), name).toBeDefined();
            } else {
              const sentence = within(block).getByText(input.sentence);
              expectRole(sentence, 'body', scale, name);
              expect(sentence.style.color, name).toBe(written(color[theme].text));
              if (input.source !== null) {
                const source = within(block).getByText(input.source);
                expectRole(source, 'mono', scale, name);
                expect(source.style.color, name).toBe(written(color[theme].textSecondary));
                expect(block.textContent, name).toBe(`${input.sentence}${input.source}`);
              }
            }
          });
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the four states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.meter-inputs-${kebab(state)}`);
    }
    expect(STATES.known.inputs).toHaveLength(3);
    expect(STATES.known.inputs[0]).toMatchObject({
      sentence: 'Nobody filed against the holder in 2023.',
      source: 'wrencounty.example. Checked Nov 9.',
    });
    expect(STATES.unknown.inputs).toEqual([
      { id: 'margin', sentence: null, unknownLabel: 'Margin last time', source: null },
    ]);
    expect(STATES.knownNoSource.inputs[0]).toMatchObject({
      sentence: 'About 14,800 people live here.',
      source: null,
    });
    expect(STATES.withSourceLink.inputs).toBe(STATES.known.inputs);
    expect(STATES.withSourceLink.sourceLink.text).toBe('Low confidence · Sources');
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const props = ALL[state];
      const panel = draw(props);
      // The panel is read as text, in order; its one control is the source row that closes it.
      expect(panel.getAttribute('role'), state).toBeNull();
      expect(panel.getAttribute('aria-label'), state).toBeNull();
      const buttons = within(panel).queryAllByRole('button');
      if (props.sourceLink === undefined) {
        expect(buttons, state).toHaveLength(0);
      } else {
        expect(buttons, state).toHaveLength(1);
        expect(buttons[0]?.getAttribute('aria-label'), state).toBe(props.sourceLink.text);
      }
    }
  });

  it('has a testID', () => {
    for (const state of STATE_NAMES) {
      const props = ALL[state];
      const panel = draw(props);
      expect(panel.getAttribute('data-testid'), state).toMatch(TEST_ID);
      const ids = [...document.querySelectorAll('[data-testid]')].map((part) =>
        part.getAttribute('data-testid'),
      );
      expect(ids, state).toEqual(
        props.sourceLink === undefined ? [props.testID] : [props.testID, props.sourceLink.testID],
      );
    }
    // The id is the caller's to give: a panel without one draws none.
    cleanup();
    renderWithProviders(<MeterInputs inputs={STATES.unknown.inputs} />);
    expect(document.querySelectorAll('[data-testid]')).toHaveLength(0);
    expect(screen.getByText('Margin last time')).toBeDefined();
  });

  it('respects reduced motion', () => {
    // The panel appears with a cut: nothing in it slides or fades, with reduced motion or without.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const panel = draw(ALL[state], { reducedMotion });
        for (const part of [panel, ...panel.querySelectorAll<HTMLElement>('*')]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
          expect(part.style.opacity, state).toBe('');
        }
      }
    }
  });

  it('shows not known yet', () => {
    for (const theme of ['light', 'dark'] as const) {
      const panel = draw(STATES.unknown, { theme });
      // The tag says it in words, at full contrast: never a dash, never a blank, never faded.
      const words = within(panel).getByText(UNKNOWN);
      expect(words.style.color, theme).toBe(written(color[theme].text));
      expect(within(panel).getByText('Margin last time').style.color, theme).toBe(
        written(color[theme].text),
      );
      expect(panel.textContent, theme).toBe(`Margin last time${UNKNOWN}`);
    }
  });

  it('unknown input', () => {
    const panel = draw(STATES.unknown);
    const { blocks } = partsOf(panel);
    expect(blocks).toHaveLength(1);
    const [block] = blocks as [HTMLElement];
    const label = within(block).getByText('Margin last time');
    const tag = within(block).getByText(UNKNOWN);
    expectRole(label, 'body', 1, 'label');
    // The label, then the tag, in a row that wraps where the label is long.
    expect(label.compareDocumentPosition(tag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.style.flexDirection).toBe('row');
    expect(block.style.flexWrap).toBe('wrap');
    // No source line: nothing is set in grey.
    const grey = written(color.light.textSecondary);
    for (const part of block.querySelectorAll<HTMLElement>('*')) {
      expect(part.style.color).not.toBe(grey);
    }
    expect(block.textContent).toBe(`Margin last time${UNKNOWN}`);
  });

  it('a known input with no source shows its sentence alone', () => {
    const errors = vi.spyOn(console, 'error');
    const panel = draw(STATES.knownNoSource);
    const { blocks } = partsOf(panel);
    expect(blocks).toHaveLength(1);
    const [block] = blocks as [HTMLElement];
    const sentence = within(block).getByText('About 14,800 people live here.');
    expectRole(sentence, 'body', 1, 'sentence');
    // The sentence is the block's only child: no source line, no tag, no gap kept for either.
    expect(block.children).toHaveLength(1);
    expect(block.firstElementChild).toBe(sentence);
    expect(block.textContent).toBe('About 14,800 people live here.');
    expect(within(panel).queryByText(UNKNOWN)).toBeNull();
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();

    // Beside inputs that have their sources, it is drawn the same way.
    const mixed = draw({
      inputs: [...STATES.known.inputs, ...STATES.knownNoSource.inputs],
      testID: 'fixture.inputs',
    });
    const last = partsOf(mixed).blocks.at(-1);
    expect(last?.children).toHaveLength(1);
    expect(last?.textContent).toBe('About 14,800 people live here.');
  });

  it('the source link closes the panel', () => {
    const onPress = vi.fn();
    const panel = draw({
      ...STATES.withSourceLink,
      sourceLink: { ...STATES.withSourceLink.sourceLink, onPress },
    });
    const { blocks } = partsOf(panel);
    const link = screen.getByTestId(STATES.withSourceLink.sourceLink.testID);
    // The last child of the column, after every input.
    expect(blocks).toHaveLength(STATES.withSourceLink.inputs.length + 1);
    const last = blocks.at(-1);
    expect(last === link || last?.contains(link) === true).toBe(true);
    for (const block of blocks.slice(0, -1)) {
      expect(block.contains(link)).toBe(false);
    }
    expect(link.textContent).toBe('Low confidence · Sources');
    fireEvent.click(link);
    expect(onPress).toHaveBeenCalledTimes(1);
    // Without the prop there is no row.
    expect(within(draw(STATES.known)).queryAllByRole('button')).toHaveLength(0);
  });
});
