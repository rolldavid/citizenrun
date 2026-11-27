import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, rule, size, space } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import type { InteractionPreviewState } from './pressable';
import { SourceLink } from './source-link';
import type { SourceLinkProps } from './source-link';
import { GROUND, PREVIEW, STATES } from './source-link.fixtures';

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
  'high',
  'medium',
  'low',
  'noConfidence',
  'feed',
  'longText',
  'hover',
  'focus',
] as const;

const ALL: Readonly<Record<StateName, SourceLinkProps>> = STATES;
const PREVIEWS: Readonly<Partial<Record<StateName, InteractionPreviewState>>> = PREVIEW;

const COMPACT = [360, 740] as const;
const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const CHEVRON = 'M9 5l7 7-7 7';
const LINE = 'wrencounty.example. Checked Mon, Nov 9.';

const WORDS = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };

/** What a row prints and says: the line alone, or the confidence in words before it once. */
function saidOf(props: SourceLinkProps): string {
  const level = props.confidence;
  if (level === null || props.text.startsWith(WORDS[level])) {
    return props.text;
  }
  return `${WORDS[level]}. ${props.text}`;
}

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

/** Renders one source link, inside a preview when one is given, and gives back its target. */
function draw(
  props: SourceLinkProps,
  options: RenderWithProvidersOptions = {},
  preview?: InteractionPreviewState,
): HTMLElement {
  cleanup();
  const element = <SourceLink {...props} />;
  renderWithProviders(
    preview === undefined ? (
      element
    ) : (
      <InteractionPreview state={preview}>{element}</InteractionPreview>
    ),
    options,
  );
  return screen.getByTestId(props.testID);
}

/** The run of words that carries the underline: the words the row prints. */
function underlineOf(target: HTMLElement, said: string): HTMLElement {
  return within(target).getByText(said);
}

/** The one line of text the mark and the words stand in. */
function lineOf(target: HTMLElement, said: string): HTMLElement {
  const run = underlineOf(target, said);
  const line = run.parentElement;
  if (line === null) {
    throw new Error('the words stand in no line of text');
  }
  return line;
}

describe('SourceLink', () => {
  it('renders every state', () => {
    setViewport(...COMPACT);
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const target = draw(ALL[state], { theme, textScale: scale }, PREVIEWS[state]);
          const name = `${state} ${theme} ${String(scale)}`;
          const line = lineOf(target, saidOf(ALL[state]));
          // The source line: grey mono, with nothing cut from its end.
          expect(line.style.color, name).toBe(written(color[theme].textSecondary));
          expect(line.style.fontFamily, name).toContain('ChivoMono');
          expect(window.getComputedStyle(line).whiteSpace, name).not.toBe('nowrap');
          expect(line.style.webkitLineClamp, name).toBeFalsy();
          // A chevron at the end of the row.
          expect(target.querySelector('path')?.getAttribute('d'), name).toBe(CHEVRON);
          // The mark and the words are one line of text, so it wraps where a word ends.
          expect(target.textContent, name).toBe(saidOf(ALL[state]));
          const level = ALL[state].confidence;
          if (level !== null) {
            const words = target.textContent;
            expect(words.split(WORDS[level]), name).toHaveLength(2);
            const pip = [...line.querySelectorAll<HTMLElement>('*')].find(
              (part) => part.style.width === `${String(size.confidencePip.width)}px`,
            );
            expect(pip, name).toBeDefined();
          }
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the eight states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    for (const state of STATE_NAMES) {
      expect(ALL[state].testID, state).toBe(`gallery.source-link-${kebab(state)}`);
    }
    expect(STATES.medium.text).toBe(LINE);
    expect(STATES.feed).toMatchObject({
      confidence: 'medium',
      text: 'Medium confidence · Sources',
    });
    // A host of 70 characters, then the date the line must not lose.
    expect(STATES.longText.text.split('. Checked ')[0]).toHaveLength(70);
    expect(STATES.longText.text.endsWith('Checked Mon, Nov 9.')).toBe(true);
    expect(PREVIEW).toEqual({ hover: { hovered: true }, focus: { focused: true } });
    expect(GROUND).toEqual({});
  });

  it('has a label and a role', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const target = draw(ALL[state]);
      expect(target.getAttribute('role'), state).toBe('button');
      // The name is what the row prints, so what is seen is what is read.
      expect(target.getAttribute('aria-label'), state).toBe(saidOf(ALL[state]));
    }
  });

  it('has a testID', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const target = draw(ALL[state]);
      expect(target.getAttribute('data-testid'), state).toMatch(TEST_ID);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(1);
    }
  });

  it('respects reduced motion', () => {
    setViewport(...COMPACT);
    // The row cuts to its fill and its underline and never moves, with reduced motion or without.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        const target = draw(ALL[state], { reducedMotion }, { pressed: true, hovered: true });
        for (const part of [target, ...target.querySelectorAll<HTMLElement>('*')]) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
        }
      }
    }
  });

  it('the name carries the confidence', () => {
    setViewport(...COMPACT);
    const target = draw(STATES.medium);
    expect(
      screen.getByRole('button', {
        name: 'Medium confidence. wrencounty.example. Checked Mon, Nov 9.',
      }),
    ).toBe(target);
    draw(STATES.high);
    expect(screen.getByRole('button', { name: `High confidence. ${LINE}` })).toBeTruthy();
    draw(STATES.low);
    expect(screen.getByRole('button', { name: `Low confidence. ${LINE}` })).toBeTruthy();
    // The pips are drawn and never read.
    const pips = [...draw(STATES.medium).querySelectorAll<HTMLElement>('*')].filter(
      (part) => part.style.width === `${String(size.confidencePip.width)}px`,
    );
    expect(pips).toHaveLength(size.confidencePips);
    for (const pip of pips) {
      expect(pip.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('a card row says its confidence once', () => {
    setViewport(...COMPACT);
    const target = draw(STATES.feed);
    expect(screen.getByRole('button', { name: 'Medium confidence · Sources' })).toBe(target);
    expect(target.textContent).toBe('Medium confidence · Sources');
    const lit = [...target.querySelectorAll<HTMLElement>('*')].filter(
      (part) =>
        part.style.width === `${String(size.confidencePip.width)}px` &&
        part.style.backgroundColor !== '',
    );
    expect(lit).toHaveLength(2);
  });

  it('no confidence, no badge', () => {
    setViewport(...COMPACT);
    const target = draw(STATES.noConfidence);
    expect(screen.getByRole('button', { name: LINE })).toBe(target);
    expect(target.textContent).toBe(LINE);
    // No pip is drawn.
    const pips = [...target.querySelectorAll<HTMLElement>('*')].filter(
      (part) => part.style.width === `${String(size.confidencePip.width)}px`,
    );
    expect(pips).toHaveLength(0);
    // With a confidence there are three.
    const marked = draw(STATES.high);
    expect(
      [...marked.querySelectorAll<HTMLElement>('*')].filter(
        (part) => part.style.width === `${String(size.confidencePip.width)}px`,
      ),
    ).toHaveLength(size.confidencePips);
  });

  it('one target at least 44 high', () => {
    setViewport(...COMPACT);
    const onPress = vi.fn();
    const target = draw({ ...STATES.medium, onPress });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    const row = [...target.querySelectorAll<HTMLElement>('*')].find(
      (part) => part.style.minHeight !== '',
    );
    expect(row?.style.minHeight).toBe(`${String(size.target)}px`);
    expect(row?.style.paddingTop).toBe(`${String(space.x2)}px`);
    // A press anywhere in the row is one call; the row opens no address itself.
    fireEvent.click(within(target).getByText(`Medium confidence. ${LINE}`));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(target.getAttribute('href')).toBeNull();
  });

  it('underline under a pointer and on focus', () => {
    setViewport(...COMPACT);
    const said = `High confidence. ${LINE}`;
    for (const theme of ['light', 'dark'] as const) {
      const rest = underlineOf(draw(STATES.high, { theme }), said);
      expect(rest.style.textDecorationLine).toBe('');
      for (const state of ['hover', 'focus'] as const) {
        // The words themselves are underlined, line by line as they wrap, never a rule under a box.
        const run = underlineOf(draw(ALL[state], { theme }, PREVIEWS[state]), said);
        expect(run.style.textDecorationLine, state).toBe('underline');
        expect(run.style.textDecorationColor, state).toBe(written(color[theme].textSecondary));
        expect(run.style.textDecorationThickness, state).toBe(`${String(rule.underline)}px`);
        for (const part of [run, ...run.querySelectorAll<HTMLElement>('*')]) {
          expect(part.style.borderBottomWidth, state).toBe('');
        }
      }
    }
  });
});
