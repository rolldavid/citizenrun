import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { linksFake } from '@/test/platform/links';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { motion } from '@/ui/motion';
import { useShortcut } from '@/ui/shortcuts';
import type { KeyEventLike } from '@/ui/shortcuts';
import { color, gutter, rule, size, space, z } from '@/ui/tokens';

import { Dialog } from './dialog';
import type { DialogProps } from './dialog';
import { GROUND, PREVIEW, STATES } from './dialog.fixtures';

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

const STATE_NAMES = [
  'confirm',
  'destructive',
  'withChildren',
  'large',
  'notDismissible',
  'longTitle',
] as const;

const NARROW = [360, 740] as const;
const COMPACT = [390, 844] as const;
const MEDIUM = [820, 1180] as const;
const EXPANDED = [1440, 900] as const;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;
const PROBE = 'probe.dialog';

afterEach(() => {
  vi.useRealTimers();
});

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one dialog, in place of whatever was drawn before, and gives back its frame. */
function draw(props: DialogProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<Dialog {...props} />, options);
  return screen.getByTestId(props.testID);
}

/** An open dialog under the probe id: a question with no action unless told otherwise. */
function probe(given: Partial<DialogProps> = {}): DialogProps {
  return {
    open: true,
    onClose: () => undefined,
    title: 'Leave this page?',
    testID: PROBE,
    ...given,
  };
}

/** The scrim: the view after the frame, which fills the window behind it. */
function scrimOf(frame: HTMLElement): HTMLElement {
  const scrim = frame.nextElementSibling;
  if (!(scrim instanceof HTMLElement)) {
    throw new Error('the dialog has no scrim');
  }
  return scrim;
}

/** A press and release of Escape, as a key press sends them to the page. */
function pressEscape(): void {
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.keyUp(document, { key: 'Escape' });
}

function keyEvent(key: string): KeyEventLike {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    inTextField: false,
    preventDefault: () => undefined,
  };
}

function emit(event: KeyEventLike): void {
  act(() => {
    linksFake.emitKey(event);
  });
}

function Shortcut({ onKey }: { onKey: () => void }): null {
  useShortcut({ key: 'j', description: 'fixture j', handler: onKey });
  return null;
}

/** The test ids of the action buttons, in the order they are drawn. */
function actionOrder(frame: HTMLElement): (string | null)[] {
  return within(frame)
    .getAllByRole('button')
    .map((button) => button.getAttribute('data-testid'));
}

describe('Dialog', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const viewport of [COMPACT, MEDIUM, EXPANDED]) {
      setViewport(viewport[0], viewport[1]);
      for (const theme of ['light', 'dark'] as const) {
        for (const state of STATE_NAMES) {
          const frame = draw(STATES[state], { theme });
          const name = `${state} ${theme} ${String(viewport[0])}`;
          // Flat: the surface, a hairline of rule all round, no radius and no shadow.
          expect(frame.style.backgroundColor, name).toBe(written(color[theme].surface));
          expect(frame.style.borderColor, name).toBe(written(color[theme].rule));
          expect(frame.style.borderWidth, name).toBe(`${String(rule.hairline)}px`);
          expect(frame.style.borderRadius, name).toBe('0px');
          expect(frame.style.boxShadow, name).toBe('');
          expect(frame.style.zIndex, name).toBe(String(z.overlay));
          const scrim = scrimOf(frame);
          expect(scrim.style.backgroundColor, name).toBe(written(color[theme].scrim));
          expect(scrim.style.position, name).toBe('absolute');
          expect(scrim.style.zIndex, name).toBe(String(z.scrim));
        }
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the six states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    expect(PREVIEW).toEqual({});
    expect(GROUND).toEqual({});
    for (const state of STATE_NAMES) {
      const fixture: DialogProps = STATES[state];
      expect(fixture.open, state).toBe(true);
      expect(fixture.testID, state).toMatch(TEST_ID);
      for (const action of fixture.actions ?? []) {
        expect(action.testID, state).toMatch(TEST_ID);
      }
    }
    expect(STATES.large.size).toBe('lg');
    expect(STATES.notDismissible.dismissible).toBe(false);
  });

  it('is a dialog labelled by its title', () => {
    setViewport(...COMPACT);
    const frame = draw(STATES.confirm);
    expect(screen.getByRole('dialog', { name: 'Make this run public?' })).toBe(frame);
    expect(frame.getAttribute('aria-modal')).toBe('true');
    const heading = within(frame).getByRole('heading', { name: 'Make this run public?' });
    const labelledBy = frame.getAttribute('aria-labelledby');
    expect(labelledBy).not.toBeNull();
    expect(document.getElementById(labelledBy ?? '')?.contains(heading)).toBe(true);
    expect(
      within(frame).getByText('Your name will show on the office page, marked Not verified.'),
    ).toBeDefined();
    // The large frame draws its children alone, and takes its name from the title.
    const large = draw(STATES.large);
    expect(screen.getByRole('dialog', { name: 'Post by Dana Okafor' })).toBe(large);
    expect(large.getAttribute('aria-labelledby')).toBeNull();
    expect(large.style.padding).toBe('');
    expect(large.style.maxWidth).toBe(`${String(size.profileColumn)}px`);
    expect(large.style.maxHeight).toBe('90%');
  });

  it('the small frame is at most the dialog width, inside the gutter on a phone', () => {
    setViewport(...COMPACT);
    const frame = draw(STATES.confirm);
    expect(frame.style.maxWidth).toBe(`${String(size.dialogMax)}px`);
    expect(frame.style.padding).toBe(`${String(space.x6)}px`);
    expect(frame.parentElement?.style.padding).toBe(`${String(gutter.regular)}px`);
    expect(frame.parentElement?.style.alignItems).toBe('center');
    expect(frame.parentElement?.style.justifyContent).toBe('center');
    setViewport(...NARROW);
    expect(draw(STATES.confirm).parentElement?.style.padding).toBe(`${String(gutter.narrow)}px`);
    // The large frame has no padding of its own, and never reaches the edges of the window: in
    // one narrower than the frame may be, the gutter stays clear at each side.
    for (const [viewport, clear] of [
      [NARROW, gutter.narrow],
      [COMPACT, gutter.regular],
      [MEDIUM, gutter.regular],
      [[size.profileColumn - 1, 900], gutter.regular],
      [EXPANDED, gutter.regular],
    ] as const) {
      setViewport(viewport[0], viewport[1]);
      const large = draw(STATES.large);
      const name = String(viewport[0]);
      expect(large.style.padding, name).toBe('');
      expect(large.style.maxWidth, name).toBe(`${String(size.profileColumn)}px`);
      expect(large.parentElement?.style.paddingLeft, name).toBe(`${String(clear)}px`);
      expect(large.parentElement?.style.paddingRight, name).toBe(`${String(clear)}px`);
      // Above and under it the frame keeps a twentieth of the window, as before.
      expect(large.parentElement?.style.paddingTop, name).toBe('');
      expect(large.style.maxHeight, name).toBe('90%');
    }
  });

  it('is an alertdialog with a destructive action', () => {
    setViewport(...COMPACT);
    const frame = draw(STATES.destructive);
    expect(screen.getByRole('alertdialog', { name: 'Delete this post?' })).toBe(frame);
    expect(frame.getAttribute('aria-modal')).toBe('true');
    expect(draw(STATES.confirm).getAttribute('role')).toBe('dialog');
  });

  it('puts the primary or destructive action last', () => {
    setViewport(...COMPACT);
    const press = (): void => undefined;
    const given = draw(
      probe({
        actions: [
          { label: 'Save', variant: 'primary', onPress: press, testID: 'probe.save' },
          { label: 'Cancel', variant: 'quiet', onPress: press, testID: 'probe.cancel' },
          { label: 'Discard', variant: 'secondary', onPress: press, testID: 'probe.discard' },
        ],
      }),
    );
    expect(actionOrder(given)).toEqual(['probe.cancel', 'probe.discard', 'probe.save']);

    const destructive = draw(
      probe({
        actions: [
          { label: 'Delete', variant: 'destructive', onPress: press, testID: 'probe.delete' },
          { label: 'Cancel', variant: 'quiet', onPress: press, testID: 'probe.cancel' },
        ],
      }),
    );
    expect(actionOrder(destructive)).toEqual(['probe.cancel', 'probe.delete']);
    // Focus starts on the first action, which is never the destructive one.
    expect(document.activeElement).toBe(screen.getByTestId('probe.cancel'));

    const fixture = draw(STATES.destructive);
    expect(actionOrder(fixture)).toEqual([
      'gallery.dialog-destructive-cancel',
      'gallery.dialog-destructive-delete',
    ]);
    expect(document.activeElement).toBe(screen.getByTestId('gallery.dialog-destructive-cancel'));
    // The actions stand in a row at the end, under the text.
    const row = screen
      .getByTestId('gallery.dialog-destructive-cancel')
      .closest<HTMLElement>('[style*="justify-content: flex-end"]');
    expect(row?.style.flexDirection).toBe('row');
    expect(row?.style.gap).toBe(`${String(space.x2)}px`);
    expect(row?.style.marginTop).toBe(`${String(space.x6)}px`);
  });

  it('an action reaches its caller', () => {
    setViewport(...COMPACT);
    const onPress = vi.fn<() => void>();
    const onClose = vi.fn<() => void>();
    draw(
      probe({
        onClose,
        actions: [{ label: 'Save', variant: 'primary', onPress, testID: 'probe.save' }],
      }),
    );
    fireEvent.click(screen.getByTestId('probe.save'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Escape and the scrim close it when dismissible', () => {
    setViewport(...COMPACT);
    const onClose = vi.fn<() => void>();
    draw({ ...STATES.confirm, onClose });
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
    const scrim = screen.getByTestId('gallery.dialog-confirm-scrim');
    expect(screen.getByRole('button', { name: 'Close' })).toBe(scrim);
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('stays open when not dismissible', () => {
    setViewport(...COMPACT);
    const onClose = vi.fn<() => void>();
    const frame = draw({ ...STATES.notDismissible, onClose });
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId('gallery.dialog-not-dismissible-scrim')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
    // The scrim is still drawn; it takes no press.
    expect(scrimOf(frame).style.backgroundColor).toBe(written(color.light.scrim));
    expect(frame.isConnected).toBe(true);
  });

  it('refuses a fourth action', () => {
    setViewport(...COMPACT);
    // React reports the error it rethrows; the report is not what this case is about.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const press = (): void => undefined;
    const four = ['one', 'two', 'three', 'four'].map((name) => ({
      label: name,
      variant: 'quiet' as const,
      onPress: press,
      testID: `probe.${name}`,
    }));
    cleanup();
    expect(() => renderWithProviders(<Dialog {...probe({ actions: four })} />)).toThrow(
      'A dialog has at most three actions',
    );
    cleanup();
    expect(draw(probe({ actions: four.slice(0, 3) })).isConnected).toBe(true);
  });

  it('opening a second dialog closes the first', () => {
    setViewport(...COMPACT);
    const closeFirst = vi.fn<() => void>();
    const closeSecond = vi.fn<() => void>();
    function Two({ second }: { second: boolean }): JSX.Element {
      return (
        <>
          <Dialog {...STATES.confirm} onClose={closeFirst} />
          <Dialog {...STATES.destructive} open={second} onClose={closeSecond} />
        </>
      );
    }
    cleanup();
    const view: RenderResult = renderWithProviders(<Two second={false} />);
    expect(closeFirst).not.toHaveBeenCalled();
    view.rerender(<Two second={true} />);
    expect(closeFirst).toHaveBeenCalledTimes(1);
    expect(closeSecond).not.toHaveBeenCalled();
  });

  it('single-key shortcuts wait while it is open', () => {
    setViewport(...COMPACT);
    const onKey = vi.fn<() => void>();
    function Page({ open }: { open: boolean }): JSX.Element {
      return (
        <>
          <Shortcut onKey={onKey} />
          <Dialog {...STATES.confirm} open={open} />
        </>
      );
    }
    cleanup();
    const view = renderWithProviders(<Page open={true} />);
    emit(keyEvent('j'));
    expect(onKey).not.toHaveBeenCalled();
    view.rerender(<Page open={false} />);
    emit(keyEvent('j'));
    expect(onKey).toHaveBeenCalledTimes(1);
  });

  it('fades in, and stays until the fade out has run', () => {
    setViewport(...COMPACT);
    vi.useFakeTimers();
    cleanup();
    const view = renderWithProviders(<Dialog {...STATES.confirm} open={false} />);
    expect(screen.queryByTestId('gallery.dialog-confirm')).toBeNull();

    view.rerender(<Dialog {...STATES.confirm} />);
    const frame = screen.getByTestId('gallery.dialog-confirm');
    // Laid out clear, so the fade has somewhere to start.
    expect(frame.style.opacity).toBe('0');
    act(() => {
      vi.advanceTimersByTime(motion.duration.fade);
    });
    expect(frame.style.opacity).toBe('1');
    expect(scrimOf(frame).style.opacity).toBe('1');

    view.rerender(<Dialog {...STATES.confirm} open={false} />);
    expect(frame.style.opacity).toBe('0');
    expect(scrimOf(frame).style.opacity).toBe('0');
    act(() => {
      vi.advanceTimersByTime(motion.duration.fade - 1);
    });
    expect(screen.queryByTestId('gallery.dialog-confirm')).toBe(frame);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('gallery.dialog-confirm')).toBeNull();
  });

  it('respects reduced motion', () => {
    setViewport(...COMPACT);
    vi.useFakeTimers();
    const frame = draw(STATES.confirm, { reducedMotion: true });
    act(() => {
      vi.advanceTimersByTime(motion.duration.fade);
    });
    // The preset is the fade it already is: opacity alone, and nothing moves or grows.
    expect(frame.style.opacity).toBe('1');
    expect(frame.style.transform).toBe('');
    expect(frame.style.animationName).toBe('');
    expect(scrimOf(frame).style.opacity).toBe('1');
    expect(scrimOf(frame).style.transform).toBe('');
  });
});
