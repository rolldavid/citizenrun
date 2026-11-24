import { BRAND, typeRoles } from '@citizenrun/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, gutter, size, space } from '@/ui/tokens';

import { InteractionPreview } from './pressable';
import { SystemScreen } from './system-screen';
import type { SystemScreenProps } from './system-screen';
import { GROUND, PREVIEW, STATES } from './system-screen.fixtures';

// react-native-svg 15.16.0 names its CommonJS build as `main`. The test resolver picks that build,
// and it loads the phone files; the module build is the one that draws real svg elements on the web.
vi.mock('react-native-svg', () => vi.importActual('react-native-svg/lib/module/index.js'));
// The module build looks an asset up through a module that only the app's bundler provides on the web:
// https://github.com/software-mansion/react-native-svg/blob/v15.16.0/src/lib/resolveAssetUri.web.ts
// The wordmark loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('the wordmark loads no asset');
  },
}));

type StateName = keyof typeof STATES;

const STATE_NAMES = ['blocking', 'noAction', 'withSecondary', 'longText'] as const;

const NARROW = [360, 740] as const;
const COMPACT = [390, 844] as const;
const EXPANDED = [1440, 900] as const;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const MOVED = 'translateY(1px) scale(0.98)';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];

type Drawn = {
  /** The screen's own box. */
  root: HTMLElement;
  /** The box that holds the wordmark, the words and the buttons. */
  content: HTMLElement;
  title: HTMLElement;
};

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

function parts(container: HTMLElement, testID: string): Drawn {
  const root = within(container).getByTestId(testID);
  const title = within(root).getByRole('heading');
  const content = root.lastElementChild;
  if (!(content instanceof HTMLElement)) {
    throw new Error('the screen has no content');
  }
  return { root, content, title };
}

/** Renders one system screen, in place of whatever was drawn before, and finds its parts. */
function draw(props: SystemScreenProps, options: RenderWithProvidersOptions = {}): Drawn {
  cleanup();
  return parts(renderWithProviders(<SystemScreen {...props} />, options).container, props.testID);
}

/** The press targets drawn, in order. */
function controlsOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('a, button, [role="button"], [role="link"]')];
}

/** The button's own box: the part that carries its fill and its outline. */
function faceOf(control: HTMLElement): HTMLElement {
  const face = control.querySelector<HTMLElement>('[style*="min-height"]');
  if (face === null) {
    throw new Error('the button has no face');
  }
  return face;
}

/** The view that holds a part and stands directly in the content: it carries the gap before the part. */
function holderOf(content: HTMLElement, part: Element): HTMLElement {
  const holder = [...content.children].find((child) => child.contains(part));
  if (!(holder instanceof HTMLElement)) {
    throw new Error('the part is not in the content');
  }
  return holder;
}

describe('SystemScreen', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    setViewport(...COMPACT);
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={PREVIEW[state] ?? {}}>
            <SystemScreen {...STATES[state]} />
          </InteractionPreview>,
          { theme },
        );
        const { root, title } = parts(view.container, STATES[state].testID);
        expect(root.style.backgroundColor, state).toBe(written(color[theme].bg));
        expect(title.textContent, state).toBe(STATES[state].title);
        expect(within(root).getByRole('img').getAttribute('aria-label'), state).toBe(
          BRAND.displayName,
        );
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the four states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.blocking.action.variant).toBe('primary');
    expect('secondaryAction' in STATES.blocking).toBe(false);
    expect('action' in STATES.noAction).toBe(false);
    expect(STATES.withSecondary.action.variant).toBe('secondary');
    expect(STATES.withSecondary.secondaryAction.label).toBe('Sign out');
    for (const state of STATE_NAMES) {
      // Never an exclamation mark, and the name is never typed.
      expect(JSON.stringify(STATES[state]), state).not.toContain('!');
      expect(JSON.stringify(STATES[state]), state).not.toContain(BRAND.displayName);
    }
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('the title is a level 1 heading', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const { root, title } = draw(STATES[state]);
      expect(within(root).getAllByRole('heading'), state).toHaveLength(1);
      expect(
        within(root).getByRole('heading', { level: 1, name: STATES[state].title }),
        state,
      ).toBe(title);
      // A screen reader announces the screen by its heading: it takes focus when the screen appears.
      expect(title.getAttribute('tabindex'), state).toBe('-1');
      expect(document.activeElement, state).toBe(title);
    }
  });

  it('has no dismiss control and no navigation', () => {
    setViewport(...COMPACT);
    const expected: Record<StateName, string[]> = {
      blocking: ['gallery.system-screen-update'],
      noAction: [],
      withSecondary: ['gallery.system-screen-appeal', 'gallery.system-screen-sign-out'],
      longText: ['gallery.system-screen-retry'],
    };
    for (const state of STATE_NAMES) {
      const { root } = draw(STATES[state]);
      expect(
        root.querySelectorAll('nav, [role="navigation"], [role="tablist"]'),
        state,
      ).toHaveLength(0);
      // No button but the given actions: nothing closes the screen or goes back.
      expect(
        controlsOf(root).map((control) => control.getAttribute('data-testid')),
        state,
      ).toEqual(expected[state]);
      // No drawing: the wordmark is the only picture.
      expect(root.querySelectorAll('svg'), state).toHaveLength(1);
      expect(root.querySelector('svg')?.closest('[role="img"]'), state).not.toBeNull();
    }
  });

  it('the action takes the variant it is given', () => {
    setViewport(...COMPACT);
    const blocking = draw(STATES.blocking);
    const ink = faceOf(within(blocking.root).getByTestId(STATES.blocking.action.testID));
    expect(ink.style.backgroundColor).toBe(written(color.light.inverseBg));

    const suspended = draw(STATES.withSecondary);
    const outlined = faceOf(within(suspended.root).getByTestId(STATES.withSecondary.action.testID));
    expect(outlined.style.backgroundColor).toBe('');
    expect(outlined.style.borderColor).toBe(written(color.light.rule));

    const onPress = vi.fn();
    const pressed = draw({
      ...STATES.blocking,
      action: { ...STATES.blocking.action, onPress },
    });
    fireEvent.click(within(pressed.root).getByTestId(STATES.blocking.action.testID));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('the secondary action is a quiet button under the first', () => {
    setViewport(...COMPACT);
    const onPress = vi.fn();
    const state = STATES.withSecondary;
    const { root, content } = draw({
      ...state,
      secondaryAction: { ...state.secondaryAction, onPress },
    });
    const first = within(root).getByTestId(state.action.testID);
    const second = within(root).getByTestId(state.secondaryAction.testID);
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Under it, not beside it: each stands in its own box of the column.
    expect(['', 'column']).toContain(content.style.flexDirection);
    expect(holderOf(content, second)).not.toBe(holderOf(content, first));
    expect(holderOf(content, second).style.marginTop).toBe(`${String(space.x2)}px`);
    // Quiet: no fill and no outline.
    const face = faceOf(second);
    expect(face.style.backgroundColor).toBe('');
    expect(['transparent', 'rgba(0, 0, 0, 0)']).toContain(face.style.borderColor);
    expect(second.getAttribute('aria-label')).toBe('Sign out');
    fireEvent.click(second);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('is flush left at the gutter, a third of the way down', () => {
    setViewport(...COMPACT);
    const state = STATES.blocking;
    const { root, content, title } = draw(state);
    expect(root.style.flexGrow).toBe('1');
    expect(root.style.paddingLeft).toBe(`${String(gutter.regular)}px`);
    expect(root.style.paddingRight).toBe(`${String(gutter.regular)}px`);
    // The lead, then the content.
    const lead = root.firstElementChild;
    expect([...root.children]).toEqual([lead, content]);
    expect(lead instanceof HTMLElement ? lead.style.height : null).toBe('33%');
    expect(lead?.children).toHaveLength(0);
    // Never centered, and never wider than long-form text.
    expect(content.style.alignItems).toBe('flex-start');
    expect(content.style.maxWidth).toBe(`${String(size.longForm)}px`);
    expect(title.style.textAlign).toBe('');

    // In reading order: the wordmark, the title, the body, the button.
    const mark = within(root).getByRole('img');
    const body = within(root).getByText(state.body);
    const button = within(root).getByTestId(state.action.testID);
    expect([...content.children]).toEqual([
      mark,
      holderOf(content, title),
      holderOf(content, body),
      holderOf(content, button),
    ]);
    expect(mark.style.height).toBe(`${String(size.wordmarkCap.rail)}px`);
    expect(holderOf(content, title).style.marginTop).toBe(`${String(space.x8)}px`);
    expect(holderOf(content, body).style.marginTop).toBe(`${String(space.x2)}px`);
    expect(holderOf(content, button).style.marginTop).toBe(`${String(space.x6)}px`);
    expect(title.style.fontSize).toBe(`${String(typeRoles.title.size)}px`);
    expect(body.style.color).toBe(written(color.light.textSecondary));

    // A narrow phone has the narrow gutter; a wide window keeps the regular one.
    setViewport(...NARROW);
    expect(draw(state).root.style.paddingLeft).toBe(`${String(gutter.narrow)}px`);
    setViewport(...EXPANDED);
    expect(draw(state).root.style.paddingLeft).toBe(`${String(gutter.regular)}px`);
  });

  it('a lone secondary action keeps the gap of a first button', () => {
    setViewport(...COMPACT);
    const { root, content } = draw({
      title: STATES.noAction.title,
      secondaryAction: STATES.withSecondary.secondaryAction,
      testID: STATES.noAction.testID,
    });
    const only = within(root).getByTestId(STATES.withSecondary.secondaryAction.testID);
    expect(holderOf(content, only).style.marginTop).toBe(`${String(space.x6)}px`);
  });

  it('has a label and a role', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const { root } = draw(STATES[state]);
      for (const control of controlsOf(root)) {
        expect(control.getAttribute('role') ?? control.tagName.toLowerCase(), state).toBe('button');
        expect(control.getAttribute('aria-label'), state).toMatch(/^[A-Z]/);
      }
    }
  });

  it('has a testID', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const { root } = draw(STATES[state]);
      expect(root.getAttribute('data-testid'), state).toBe(STATES[state].testID);
      const ids = [root, ...root.querySelectorAll('[data-testid]')].map((element) =>
        element.getAttribute('data-testid'),
      );
      // The screen and each of its buttons, and nothing else.
      expect(ids, state).toHaveLength(1 + controlsOf(root).length);
      for (const id of ids) {
        expect(id, state).toMatch(TEST_ID);
      }
    }
  });

  it('respects reduced motion', () => {
    setViewport(...COMPACT);
    const id = STATES.blocking.action.testID;
    draw(STATES.blocking, { reducedMotion: true });
    const still = screen.getByTestId(id);
    fireEvent.keyDown(still, { key: 'Enter' });
    for (const part of [still, ...still.querySelectorAll<HTMLElement>('*')]) {
      expect(AT_REST).toContain(part.style.transform);
    }
    fireEvent.keyUp(still, { key: 'Enter' });
    // The same press moves the button where motion is allowed; the screen itself never animates.
    const { root } = draw(STATES.blocking);
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
