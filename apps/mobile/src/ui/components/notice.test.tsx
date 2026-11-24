import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { color, radius, size, space } from '@/ui/tokens';

import { Notice } from './notice';
import type { NoticeProps } from './notice';
import { GROUND, PREVIEW, STATES } from './notice.fixtures';
import { InteractionPreview } from './pressable';

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
  'info',
  'warning',
  'error',
  'infoWithAction',
  'errorWithAction',
  'pinIcon',
  'longText',
] as const;

const NARROW = [360, 740] as const;
const COMPACT = [390, 844] as const;
const MEDIUM = [820, 1180] as const;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const MOVED = 'translateY(1px) scale(0.98)';
/** A transform that moves nothing, as the page writes it. */
const AT_REST = ['', 'translateY(0px) scale(1)'];

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one notice, in place of whatever was drawn before, and gives back its block. */
function draw(props: NoticeProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  const view = renderWithProviders(<Notice {...props} />, options);
  const block = view.container.querySelector<HTMLElement>('[role="status"], [role="alert"]');
  if (block === null) {
    throw new Error('no notice was drawn');
  }
  return block;
}

/** The sentence's own element. */
function sentenceOf(block: HTMLElement, text: string): HTMLElement {
  return within(block).getByText(text);
}

describe('Notice', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    setViewport(...COMPACT);
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        cleanup();
        const view = renderWithProviders(
          <InteractionPreview state={PREVIEW[state] ?? {}}>
            <Notice {...STATES[state]} />
          </InteractionPreview>,
          { theme },
        );
        const block = view.container.querySelector<HTMLElement>('[role]');
        // One flat ground for every kind, with the control radius, no border and no tint.
        expect(block?.style.backgroundColor, state).toBe(written(color[theme].noticeBg));
        expect(block?.style.borderRadius, state).toBe(`${String(radius.control)}px`);
        expect(block?.style.padding, state).toBe(`${String(space.x3)}px`);
        expect(block?.style.borderWidth, state).toBe('');
        expect(sentenceOf(view.container, STATES[state].text), state).toBeDefined();
        expect(view.container.querySelectorAll('svg'), state).toHaveLength(1);
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
    errors.mockRestore();
    warnings.mockRestore();
  });

  it('the fixtures hold the seven states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(STATES.info.text).toBe('Showing offices nationwide.');
    expect(STATES.infoWithAction.action.label).toBe('Set location');
    expect(STATES.errorWithAction.action.label).toBe('Try again');
    expect(STATES.pinIcon.icon).toBe('pin');
    // Three sentences.
    expect(STATES.longText.text.match(/\.(?: |$)/g)).toHaveLength(3);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
  });

  it('error and warning are alerts, info is a status', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const block = draw(STATES[state]);
      expect(block.getAttribute('role'), state).toBe(
        STATES[state].kind === 'info' ? 'status' : 'alert',
      );
    }
  });

  it('the icon is hidden and the words carry the kind', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const block = draw(STATES[state]);
      const icon = block.querySelector('svg');
      // The icon is decorative: hidden, with no name and no role of its own.
      expect(icon?.closest('[aria-hidden="true"]'), state).not.toBeNull();
      expect(
        block.querySelectorAll('[role="img"], [aria-label]:not([data-testid])'),
        state,
      ).toHaveLength(0);
      expect(
        sentenceOf(block, STATES[state].text).closest('[aria-hidden="true"]'),
        state,
      ).toBeNull();
    }
  });

  it('an error sets its icon and its words in danger, and the other kinds in the text color', () => {
    setViewport(...COMPACT);
    for (const theme of ['light', 'dark'] as const) {
      for (const state of STATE_NAMES) {
        const block = draw(STATES[state], { theme });
        const expected = written(
          STATES[state].kind === 'error' ? color[theme].danger : color[theme].noticeText,
        );
        expect(sentenceOf(block, STATES[state].text).style.color, state).toBe(expected);
        const strokes = [...block.querySelectorAll('svg [stroke]')]
          .map((shape) => shape.getAttribute('stroke'))
          .filter((stroke) => stroke !== null && stroke !== 'none');
        expect(strokes.length, state).toBeGreaterThan(0);
        for (const stroke of strokes) {
          expect(written(stroke ?? ''), state).toBe(expected);
        }
      }
    }
  });

  it('the icon is the medium size and sits on the first line of the sentence', () => {
    setViewport(...COMPACT);
    const block = draw(STATES.longText);
    const icon = block.querySelector('svg')?.closest<HTMLElement>('[aria-hidden="true"]');
    expect(icon?.style.width).toBe(`${String(size.icon.medium)}px`);
    expect(icon?.style.height).toBe(`${String(size.icon.medium)}px`);
    // Its box is as tall as one line of the sentence and starts where the sentence starts.
    const box = icon?.parentElement;
    const line = sentenceOf(block, STATES.longText.text).style.lineHeight;
    expect(box?.style.minHeight).toBe(line);
    expect(box?.parentElement?.style.alignItems).toBe('flex-start');
    // At a larger text size the box grows with the line.
    const larger = draw(STATES.longText, { textScale: 1.3 });
    const largerBox = larger.querySelector('svg')?.closest('[aria-hidden="true"]')?.parentElement;
    expect(largerBox?.style.minHeight).toBe(
      sentenceOf(larger, STATES.longText.text).style.lineHeight,
    );
    expect(largerBox?.style.minHeight).not.toBe(line);
  });

  it('the pin takes the place of the kind’s own icon', () => {
    setViewport(...COMPACT);
    const own = draw(STATES.info).querySelector('svg')?.innerHTML;
    const pin = draw(STATES.pinIcon).querySelector('svg')?.innerHTML;
    expect(pin).toBeDefined();
    expect(pin).not.toBe(own);
  });

  it('the action is a small secondary button with its testID that calls onPress', () => {
    setViewport(...COMPACT);
    const onPress = vi.fn();
    const block = draw({
      kind: 'info',
      text: 'Showing offices nationwide.',
      action: { label: 'Set location', onPress, testID: 'feed.set-location' },
    });
    const button = within(block).getByTestId('feed.set-location');
    expect(button.getAttribute('role') ?? button.tagName.toLowerCase()).toBe('button');
    expect(button.getAttribute('aria-label')).toBe('Set location');
    const face = button.querySelector<HTMLElement>('[style*="min-height"]');
    // Small: the small button's height. Secondary: a hairline of the rule color and no fill.
    expect(face?.style.minHeight).toBe(`${String(size.buttonSmall)}px`);
    expect(face?.style.borderColor).toBe(written(color.light.rule));
    expect(face?.style.backgroundColor).toBe('');
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    // A notice with no action draws no button.
    expect(draw(STATES.info).querySelectorAll('[data-testid]')).toHaveLength(0);
  });

  it('the action moves under the text on a narrow screen', () => {
    const state = STATES.infoWithAction;
    setViewport(...NARROW);
    const narrow = draw(state);
    const narrowText = sentenceOf(narrow, state.text);
    const narrowButton = within(narrow).getByTestId(state.action.testID);
    // A column: the sentence, then the action under it, at the sentence's start.
    expect(['', 'column']).toContain(narrow.style.flexDirection);
    expect(narrow.style.alignItems).toBe('flex-start');
    expect(
      narrowText.compareDocumentPosition(narrowButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const holder = [...narrow.children].find((child) => child.contains(narrowButton));
    expect((holder instanceof HTMLElement ? holder : null)?.style.marginLeft).toBe(
      `${String(size.icon.medium + space.x3)}px`,
    );

    setViewport(...MEDIUM);
    const wide = draw(state);
    const wideButton = within(wide).getByTestId(state.action.testID);
    // One row: the action at the right, at the middle of the sentence.
    expect(wide.style.flexDirection).toBe('row');
    expect(wide.style.alignItems).toBe('center');
    expect(
      sentenceOf(wide, state.text).compareDocumentPosition(wideButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const wideHolder = [...wide.children].find((child) => child.contains(wideButton));
    expect((wideHolder instanceof HTMLElement ? wideHolder : null)?.style.marginLeft).toBe('');

    // A notice with no action is one row on a narrow screen as well.
    setViewport(...NARROW);
    expect(draw(STATES.info).style.flexDirection).toBe('row');
  });

  it('has a label and a role', () => {
    setViewport(...COMPACT);
    for (const state of STATE_NAMES) {
      const block = draw(STATES[state]);
      for (const control of block.querySelectorAll<HTMLElement>('[data-testid]')) {
        expect(control.getAttribute('role') ?? control.tagName.toLowerCase(), state).toBe('button');
        expect(control.getAttribute('aria-label'), state).toMatch(/^[A-Z]/);
      }
    }
  });

  it('has a testID', () => {
    setViewport(...COMPACT);
    const expected: Record<StateName, string[]> = {
      info: [],
      warning: [],
      error: [],
      infoWithAction: ['gallery.notice-set-location'],
      errorWithAction: ['gallery.notice-retry'],
      pinIcon: [],
      longText: [],
    };
    for (const state of STATE_NAMES) {
      const block = draw(STATES[state]);
      const ids = [...block.querySelectorAll('[data-testid]')].map((element) =>
        element.getAttribute('data-testid'),
      );
      expect(ids, state).toEqual(expected[state]);
      for (const id of ids) {
        expect(id, state).toMatch(TEST_ID);
      }
    }
    // The block takes the id its caller gives it.
    const block = draw({ ...STATES.info, testID: 'feed.nationwide' });
    expect(block.getAttribute('data-testid')).toBe('feed.nationwide');
  });

  it('respects reduced motion', () => {
    setViewport(...COMPACT);
    const id = STATES.infoWithAction.action.testID;
    draw(STATES.infoWithAction, { reducedMotion: true });
    const still = screen.getByTestId(id);
    fireEvent.keyDown(still, { key: 'Enter' });
    for (const part of [still, ...still.querySelectorAll<HTMLElement>('*')]) {
      expect(AT_REST).toContain(part.style.transform);
    }
    fireEvent.keyUp(still, { key: 'Enter' });
    // The same press moves the button where motion is allowed; the block itself never animates.
    const block = draw(STATES.infoWithAction);
    const button = screen.getByTestId(id);
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(
      [...button.querySelectorAll<HTMLElement>('*')].map((part) => part.style.transform),
    ).toContain(MOVED);
    fireEvent.keyUp(button, { key: 'Enter' });
    for (const part of [block, ...block.querySelectorAll<HTMLElement>('*')]) {
      expect(part.style.animationName).toBe('');
    }
  });
});
