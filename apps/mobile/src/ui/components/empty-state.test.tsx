import { typeRoles } from '@citizenrun/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, size, space } from '@/ui/tokens';

import { EmptyState } from './empty-state';
import type { EmptyStateProps } from './empty-state';
import { GROUND, PREVIEW, STATES } from './empty-state.fixtures';
import { InteractionPreview } from './pressable';

// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// The chair loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('the chair loads no asset');
  },
}));

type StateName = keyof typeof STATES;

const STATE_NAMES = [
  'empty',
  'emptyNoAction',
  'emptyHref',
  'error',
  'artNone',
  'headingOne',
  'longText',
] as const;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const MOVED = 'translateY(1px) scale(0.98)';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];

type Drawn = {
  container: HTMLElement;
  /** The component's own box. */
  root: HTMLElement;
  title: HTMLElement;
};

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function parts(container: HTMLElement): Drawn {
  const title = within(container).getByRole('heading');
  const root = title.parentElement;
  if (root === null) {
    throw new Error('the title has no box');
  }
  return { container, root, title };
}

/** Renders one empty state, in place of whatever was drawn before, and finds its parts. */
function draw(props: EmptyStateProps, options: RenderWithProvidersOptions = {}): Drawn {
  cleanup();
  return parts(renderWithProviders(<EmptyState {...props} />, options).container);
}

/** The press targets drawn: the one button, or none. */
function controlsOf(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('a, button, [role="button"], [role="link"]')];
}

/** The button's own box: the part that carries its fill and its outline. */
function faceOf(control: HTMLElement): HTMLElement {
  const face = control.querySelector<HTMLElement>('[style*="min-height"]');
  if (face === null) {
    throw new Error('the button has no face');
  }
  return face;
}

/** The view that holds a part and stands directly in the root: it carries the gap before the part. */
function holderOf(root: HTMLElement, part: Element): HTMLElement {
  const holder = [...root.children].find((child) => child.contains(part));
  if (!(holder instanceof HTMLElement)) {
    throw new Error('the part is not in the root');
  }
  return holder;
}

describe('EmptyState', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={PREVIEW[state] ?? {}}>
            <EmptyState {...STATES[state]} />
          </InteractionPreview>,
          { theme },
        );
        const { title } = parts(view.container);
        expect(title.textContent, state).toBe(STATES[state].title);
        expect(title.style.color, state).toBe(written(color[theme].text));
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the seven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.empty.title).toBe('Nothing saved yet.');
    expect(STATES.empty.body).toBe('Bookmark an office and it stays here with its filing date.');
    expect(STATES.empty.action.label).toBe('Explore offices');
    expect('action' in STATES.emptyNoAction).toBe(false);
    expect(STATES.emptyHref.action.href).toBe('/');
    expect(STATES.error.kind).toBe('error');
    expect(STATES.artNone.art).toBe('none');
    expect(STATES.headingOne.headingLevel).toBe(1);
    for (const state of STATE_NAMES) {
      // Never an exclamation mark.
      expect(JSON.stringify(STATES[state]), state).not.toContain('!');
    }
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('the title is a level 2 heading by default and level 1 when asked', () => {
    for (const state of STATE_NAMES) {
      const { container, title } = draw(STATES[state]);
      const level = state === 'headingOne' ? 1 : 2;
      expect(within(container).getAllByRole('heading'), state).toHaveLength(1);
      expect(
        within(container).getByRole('heading', { level, name: STATES[state].title }),
        state,
      ).toBe(title);
    }
  });

  it('a level 1 title takes focus when it appears, and a level 2 title does not', () => {
    const one = draw(STATES.headingOne);
    expect(one.title.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(one.title);
    const two = draw(STATES.empty);
    expect(two.title.getAttribute('tabindex')).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it('an error reads Try again and calls onPress', () => {
    const onPress = vi.fn();
    const { container } = draw({
      kind: 'error',
      title: STATES.error.title,
      action: { label: 'Reload', onPress, testID: 'saved.retry' },
    });
    const button = within(container).getByTestId('saved.retry');
    expect(button.getAttribute('aria-label')).toBe('Try again');
    expect(button.textContent).toBe('Try again');
    expect(within(container).queryByText('Reload')).toBeNull();
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    // The same layout as an empty state: the chair, the title, the button.
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    // An empty state keeps the label it was given.
    const empty = draw(STATES.empty);
    expect(controlsOf(empty.container)[0]?.getAttribute('aria-label')).toBe('Explore offices');
  });

  it('art none drops the drawing', () => {
    for (const state of STATE_NAMES) {
      const { container } = draw(STATES[state]);
      expect(container.querySelectorAll('svg'), state).toHaveLength(state === 'artNone' ? 0 : 1);
    }
    // The chair is drawn at the size of an empty state's drawing, hidden from screen readers.
    const { container } = draw(STATES.empty);
    const chair = container.querySelector('svg')?.parentElement;
    expect(chair?.getAttribute('aria-hidden')).toBe('true');
    expect(chair?.style.width).toBe(`${String(size.drawingEmpty)}px`);
  });

  it('draws one button at most', () => {
    const expected: Record<StateName, number> = {
      empty: 1,
      emptyNoAction: 0,
      emptyHref: 1,
      error: 1,
      artNone: 1,
      headingOne: 1,
      longText: 1,
    };
    for (const state of STATE_NAMES) {
      const { container } = draw(STATES[state]);
      expect(controlsOf(container), state).toHaveLength(expected[state]);
    }
  });

  it('the chair is the only accent', () => {
    for (const theme of ['light', 'dark'] as const) {
      const accent = written(color[theme].accent);
      for (const state of STATE_NAMES) {
        const { container } = draw(STATES[state], { theme });
        const painted = [...container.querySelectorAll<HTMLElement | SVGElement>('*')].filter(
          (element) =>
            [
              element.style.backgroundColor,
              element.style.color,
              element.style.borderColor,
              written(element.getAttribute('fill') ?? ''),
              written(element.getAttribute('stroke') ?? ''),
            ].includes(accent),
        );
        // The seat, and nothing else: no accent text, fill or outline, and no Run button.
        expect(painted, state).toHaveLength(state === 'artNone' ? 0 : 1);
        for (const element of painted) {
          expect(element.closest('svg'), state).not.toBeNull();
        }
      }
    }
  });

  it('is flush left with the gaps of its parts', () => {
    const { root, title, container } = draw(STATES.empty);
    // Never centered.
    expect(root.style.alignItems).toBe('flex-start');
    expect(root.style.paddingTop).toBe(`${String(space.x6)}px`);
    expect(root.style.paddingBottom).toBe(`${String(space.x6)}px`);
    expect(title.style.textAlign).toBe('');

    const chair = container.querySelector('svg');
    const body = within(container).getByText(STATES.empty.body);
    const button = within(container).getByTestId(STATES.empty.action.testID);
    if (chair === null) {
      throw new Error('no chair was drawn');
    }
    // In reading order: the chair, the title, the body, the button.
    expect([...root.children]).toEqual([
      holderOf(root, chair),
      title,
      holderOf(root, body),
      holderOf(root, button),
    ]);
    expect(holderOf(root, chair).style.marginBottom).toBe(`${String(space.x6)}px`);
    expect(holderOf(root, body).style.marginTop).toBe(`${String(space.x2)}px`);
    expect(holderOf(root, button).style.marginTop).toBe(`${String(space.x6)}px`);

    // The title role, and the body role in the secondary color.
    expect(title.style.fontSize).toBe(`${String(typeRoles.title.size)}px`);
    expect(body.style.fontSize).toBe(`${String(typeRoles.body.size)}px`);
    expect(body.style.color).toBe(written(color.light.textSecondary));
  });

  it('the button is ink by default and outlined when asked', () => {
    const primary = draw(STATES.empty);
    const ink = faceOf(within(primary.container).getByTestId(STATES.empty.action.testID));
    expect(ink.style.backgroundColor).toBe(written(color.light.inverseBg));
    expect(ink.style.minHeight).toBe(`${String(size.button)}px`);

    const secondary = draw(STATES.artNone);
    const outlined = faceOf(within(secondary.container).getByTestId(STATES.artNone.action.testID));
    expect(outlined.style.backgroundColor).toBe('');
    expect(outlined.style.borderColor).toBe(written(color.light.rule));
  });

  it('with an address the button is a link', () => {
    const { container } = draw(STATES.emptyHref);
    const link = within(container).getByTestId(STATES.emptyHref.action.testID);
    expect(link.getAttribute('role') ?? link.tagName.toLowerCase()).toMatch(/^(a|link)$/);
    expect(link.getAttribute('href')).toBe('/');
  });

  it('a title and nothing else is drawn when that is all it is given', () => {
    const { root, title } = draw({ art: 'none', title: 'No results.' });
    expect([...root.children]).toEqual([title]);
  });

  it('has a label and a role', () => {
    for (const state of STATE_NAMES) {
      const { container } = draw(STATES[state]);
      for (const control of controlsOf(container)) {
        expect(control.getAttribute('role') ?? control.tagName.toLowerCase(), state).toMatch(
          /^(a|button|link)$/,
        );
        expect(control.getAttribute('aria-label'), state).toMatch(/^[A-Z]/);
      }
    }
  });

  it('has a testID', () => {
    const expected: Record<StateName, string[]> = {
      empty: ['gallery.empty-state-explore'],
      emptyNoAction: [],
      emptyHref: ['gallery.empty-state-href'],
      error: ['gallery.empty-state-retry'],
      artNone: ['gallery.empty-state-steps'],
      headingOne: ['gallery.empty-state-home'],
      longText: ['gallery.empty-state-long'],
    };
    for (const state of STATE_NAMES) {
      const { container } = draw(STATES[state]);
      const ids = [...container.querySelectorAll('[data-testid]')].map((element) =>
        element.getAttribute('data-testid'),
      );
      expect(ids, state).toEqual(expected[state]);
      expect(controlsOf(container).map((control) => control.getAttribute('data-testid'))).toEqual(
        ids,
      );
      for (const id of ids) {
        expect(id, state).toMatch(TEST_ID);
      }
    }
    // The box takes the id its caller gives it.
    const { root } = draw({ ...STATES.emptyNoAction, testID: 'saved.empty' });
    expect(root.getAttribute('data-testid')).toBe('saved.empty');
  });

  it('respects reduced motion', () => {
    const id = STATES.empty.action.testID;
    draw(STATES.empty, { reducedMotion: true });
    const still = screen.getByTestId(id);
    fireEvent.keyDown(still, { key: 'Enter' });
    for (const part of [still, ...still.querySelectorAll<HTMLElement>('*')]) {
      expect(AT_REST).toContain(part.style.transform);
    }
    fireEvent.keyUp(still, { key: 'Enter' });
    // The same press moves the button where motion is allowed; nothing else ever moves.
    const { root } = draw(STATES.empty);
    const button = screen.getByTestId(id);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(
      [...button.querySelectorAll<HTMLElement>('*')].map((part) => part.style.transform),
    ).toContain(MOVED);
    fireEvent.keyUp(button, { key: 'Enter' });
    for (const part of root.querySelectorAll<HTMLElement>('*')) {
      expect(part.style.animationName).toBe('');
    }
  });
});
