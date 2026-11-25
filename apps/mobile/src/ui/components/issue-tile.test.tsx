import { cleanup } from '@testing-library/react';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import type * as ReactNative from 'react-native';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { ISSUE_IDS, color, issue } from '@/ui/tokens';

import { HoverGroundContext } from './hover-ground';
import { IssueTile } from './issue-tile';
import type { IssueTileProps } from './issue-tile';
import { GROUND, PREVIEW, STATES } from './issue-tile.fixtures';
import { InteractionPreview } from './pressable';

// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// A tile loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a tile loads no asset');
  },
}));

// The props each View receives, so the cases below can read what a phone's screen reader is told:
// the web drops those props before they reach the page.
const views = vi.hoisted(() => {
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
  };
});

type StateName = keyof typeof STATES;

const STATE_NAMES = ['tile', 'keyline', 'unknown', 'labelled'] as const;

const ALL: Readonly<Record<StateName, IssueTileProps>> = STATES;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one tile and returns its square. */
function draw(props: IssueTileProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  views.props = [];
  const view = renderWithProviders(<IssueTile {...props} />, options);
  const square = [...view.container.querySelectorAll<HTMLElement>('*')].find(
    (part) => part.style.width !== '' && part.style.width === part.style.height,
  );
  if (square === undefined) {
    throw new Error('the tile draws no square');
  }
  return square;
}

describe('IssueTile', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const scale of [1, 1.3]) {
        for (const state of STATE_NAMES) {
          const square = draw(ALL[state], { theme, textScale: scale });
          const name = `${state} ${theme} ${String(scale)}`;
          // A square of 28 points, never round, whatever the text size.
          expect(square.style.width, name).toBe('28px');
          expect(square.style.height, name).toBe('28px');
          expect(square.style.borderRadius, name).toBe('0px');
          // One icon at its middle, 16 points.
          expect(square.querySelectorAll('svg'), name).toHaveLength(1);
          expect(square.querySelector('svg')?.getAttribute('width'), name).toBe('16');
          expect(square.style.alignItems, name).toBe('center');
          expect(square.style.justifyContent, name).toBe('center');
          // The keyline: where it is asked for, and round a tile with no color of its own.
          if (state === 'keyline' || state === 'unknown') {
            expect(square.style.borderWidth, name).toBe('1px');
            expect(square.style.borderColor, name).toBe(written(color[theme].rule));
          } else {
            expect(square.style.borderWidth, name).toBe('');
          }
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
    expect(STATES.unknown.issueId).toBe('not-an-issue');
    expect(STATES.keyline.keyline).toBe(true);
    expect(PREVIEW).toEqual({});
    // The keylined tile is shown on the ground its keyline is for.
    expect(GROUND).toEqual({ keyline: 'hoverBg' });
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const square = draw(ALL[state]);
      if (state === 'labelled') {
        expect(square.getAttribute('role'), state).toBe('img');
        expect(square.getAttribute('aria-label'), state).toBe('Schools');
      } else {
        // The name is printed beside the tile, so the tile says nothing.
        expect(square.getAttribute('role'), state).toBeNull();
        expect(square.getAttribute('aria-label'), state).toBeNull();
        expect(square.getAttribute('aria-hidden'), state).toBe('true');
      }
    }
  });

  it('has a testID', () => {
    // Nothing in a tile is interactive, so nothing carries an id.
    for (const state of STATE_NAMES) {
      draw(ALL[state]);
      expect(document.querySelectorAll('[data-testid]'), state).toHaveLength(0);
      expect(document.querySelectorAll('a, button, [tabindex]'), state).toHaveLength(0);
    }
  });

  it('respects reduced motion', () => {
    // A tile never moves, with reduced motion or without it.
    for (const reducedMotion of [true, false]) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={{ pressed: true }}>
            <IssueTile {...ALL[state]} />
          </InteractionPreview>,
          { reducedMotion },
        );
        for (const part of view.container.querySelectorAll<HTMLElement>('*')) {
          expect(part.style.transform, state).toBe('');
          expect(part.style.transition, state).toBe('');
          expect(part.style.animationName, state).toBe('');
        }
      }
    }
  });

  it('fill and glyph', () => {
    expect(issue['rent-housing'].light).toBe('#CD527C');
    expect(issue['rent-housing'].dark).toBe('#E96B94');
    for (const theme of ['light', 'dark'] as const) {
      const square = draw(STATES.tile, { theme });
      expect(square.style.backgroundColor, theme).toBe(written(issue['rent-housing'][theme]));
      const paths = [...square.querySelectorAll('path')];
      expect(paths.length, theme).toBeGreaterThan(0);
      for (const path of paths) {
        expect(path.getAttribute('fill'), theme).toBe(issue['rent-housing'].on);
        expect(path.getAttribute('stroke'), theme).toBeNull();
      }
    }
    // Every issue pairs its own color with the glyph color that reads on it, in both themes.
    for (const theme of ['light', 'dark'] as const) {
      for (const id of ISSUE_IDS) {
        const square = draw({ issueId: id }, { theme });
        const name = `${id} ${theme}`;
        expect(square.style.backgroundColor, name).toBe(written(issue[id][theme]));
        expect(square.querySelector('path')?.getAttribute('fill'), name).toBe(issue[id].on);
      }
    }
  });

  it('the three sizes', () => {
    for (const [size, side, icon] of [
      ['tile', '28px', '16'],
      ['chip', '44px', '20'],
      ['chipSmall', '32px', '16'],
    ] as const) {
      const square = draw({ issueId: 'transit', size });
      expect(square.style.width, size).toBe(side);
      expect(square.style.height, size).toBe(side);
      expect(square.querySelector('svg')?.getAttribute('width'), size).toBe(icon);
    }
  });

  it('unknown id', () => {
    for (const theme of ['light', 'dark'] as const) {
      const square = draw(STATES.unknown, { theme });
      // A neutral square with its keyline, and the tag icon in the text color.
      expect(square.style.backgroundColor, theme).toBe(written(color[theme].well));
      expect(square.style.borderWidth, theme).toBe('1px');
      expect(square.style.borderColor, theme).toBe(written(color[theme].rule));
      const path = square.querySelector('path');
      expect(path?.getAttribute('stroke'), theme).toBe(color[theme].text);
      expect(path?.getAttribute('fill'), theme).toBe('none');
      // No issue color anywhere in it.
      for (const id of ISSUE_IDS) {
        expect(square.style.backgroundColor, theme).not.toBe(written(issue[id][theme]));
      }
    }
    // The same for an empty id and for one that only looks like an issue's.
    for (const issueId of ['', 'Rent-Housing', 'rent-housing ']) {
      expect(draw({ issueId }).style.backgroundColor, issueId).toBe(written(color.light.well));
    }
  });

  it('label', () => {
    const labelled = draw(STATES.labelled);
    expect(labelled.getAttribute('role')).toBe('img');
    expect(labelled.getAttribute('aria-label')).toBe('Schools');
    expect(labelled.getAttribute('aria-hidden')).toBeNull();
    // On a phone the labelled tile is one element with that name.
    const said = views.props.find((props) => props['aria-label'] === 'Schools');
    expect(said?.['accessible']).toBe(true);
    expect(said?.['role']).toBe('img');
    // The glyph inside stays decoration.
    expect(labelled.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');

    const silent = draw(STATES.tile);
    expect(silent.getAttribute('aria-hidden')).toBe('true');
    expect(silent.getAttribute('role')).toBeNull();
    const hidden = views.props.find((props) => props['aria-hidden'] === true);
    expect(hidden?.['accessibilityElementsHidden']).toBe(true);
    expect(hidden?.['importantForAccessibility']).toBe('no-hide-descendants');
  });

  it('keyline assertion', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onHoveredGround = (props: IssueTileProps): void => {
      cleanup();
      renderWithProviders(
        <HoverGroundContext.Provider value={true}>
          <IssueTile {...props} />
        </HoverGroundContext.Provider>,
      );
    };
    expect(() => {
      onHoveredGround({ issueId: 'rent-housing', keyline: false });
    }).toThrow('An issue tile on a hovered ground needs its keyline');
    expect(() => {
      onHoveredGround({ issueId: 'rent-housing' });
    }).toThrow('An issue tile on a hovered ground needs its keyline');
    expect(() => {
      onHoveredGround({ issueId: 'rent-housing', keyline: true });
    }).not.toThrow();
    // Off a hovered ground a tile needs none.
    cleanup();
    expect(() => {
      renderWithProviders(
        <HoverGroundContext.Provider value={false}>
          <IssueTile issueId="rent-housing" />
        </HoverGroundContext.Provider>,
      );
    }).not.toThrow();
    errors.mockRestore();
  });
});
