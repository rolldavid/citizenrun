import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { JSX } from 'react';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { describe, expect, it, vi } from 'vitest';

import { linksFake } from '@/test/platform/links';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { motion } from '@/ui/motion';
import { useShortcut } from '@/ui/shortcuts';
import type { KeyEventLike } from '@/ui/shortcuts';
import { color, gutter, rule, size, space } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import { Sheet } from './sheet';
import type { SheetProps } from './sheet';
import { GROUND, PREVIEW, STATES } from './sheet.fixtures';

// react-native-safe-area-context 5.11.1 names its CommonJS build as `main`. The test resolver picks
// that build, and it loads the phone's React Native; the module build is the one that runs on the web:
// https://github.com/AppAndFlow/react-native-safe-area-context/blob/v5.11.1/package.json
vi.mock('react-native-safe-area-context', () =>
  vi.importActual('react-native-safe-area-context/lib/module/index.js'),
);
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

const STATE_NAMES = ['open', 'openNoTitle', 'withFooter', 'notDismissible', 'half'] as const;

const COMPACT = [390, 844] as const;
const MEDIUM = [820, 1180] as const;
const EXPANDED = [1440, 900] as const;

const TEST_ID = /^[a-z0-9-]+\.[a-z0-9-]+$/;

/** A color as the page writes it back, so a token and a rendered color compare. */
function written(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  return probe.style.color;
}

/** Renders one sheet, in place of whatever was drawn before, and gives back its frame. */
function draw(props: SheetProps, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<Sheet {...props} />, options);
  return screen.getByTestId(props.testID);
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

/** The scrim of a sheet on a phone: the layer after its frame. */
function scrimOf(frame: HTMLElement): HTMLElement {
  const scrim = frame.nextElementSibling;
  if (!(scrim instanceof HTMLElement)) {
    throw new Error('the sheet has no scrim');
  }
  return scrim;
}

/** The grabber's bar: the one drawing in the frame that is the grabber's size. */
function barOf(frame: HTMLElement): HTMLElement {
  const bar = [...frame.querySelectorAll<HTMLElement>('*')].find(
    (part) =>
      part.style.width === `${String(size.sheetGrabber.width)}px` &&
      part.style.height === `${String(size.sheetGrabber.height)}px` &&
      part.style.backgroundColor !== '',
  );
  if (bar === undefined) {
    throw new Error('the sheet has no grabber');
  }
  return bar;
}

describe('Sheet', () => {
  it('renders every state', () => {
    const errors = vi.spyOn(console, 'error');
    const warnings = vi.spyOn(console, 'warn');
    for (const theme of ['light', 'dark'] as const) {
      // A phone: the frame of the sheet, with the rule on its top edge and the grabber.
      setViewport(...COMPACT);
      for (const state of STATE_NAMES) {
        const frame = draw(STATES[state], { theme });
        const name = `${state} ${theme} compact`;
        expect(frame.style.backgroundColor, name).toBe(written(color[theme].surface));
        expect(frame.style.borderTopWidth, name).toBe(`${String(rule.hairline)}px`);
        expect(frame.style.borderTopColor, name).toBe(written(color[theme].rule));
        expect(frame.style.borderRadius, name).toBe('0px');
        expect(frame.style.boxShadow, name).toBe('');
        expect(frame.style.paddingLeft, name).toBe(`${String(gutter.regular)}px`);
        expect(frame.style.paddingRight, name).toBe(`${String(gutter.regular)}px`);
        expect(frame.style.paddingBottom, name).toBe(`${String(space.x6)}px`);
        const bar = barOf(frame);
        expect(bar.style.backgroundColor, name).toBe(written(color[theme].text));
        expect(bar.style.borderRadius, name).toBe('0px');
      }
      // A window: the same content in the dialog's frame, with no grabber.
      setViewport(...EXPANDED);
      for (const state of STATE_NAMES) {
        const frame = draw(STATES[state], { theme });
        const name = `${state} ${theme} expanded`;
        expect(frame.style.backgroundColor, name).toBe(written(color[theme].surface));
        expect(frame.style.borderWidth, name).toBe(`${String(rule.hairline)}px`);
        expect(frame.style.borderColor, name).toBe(written(color[theme].rule));
        expect(frame.style.borderRadius, name).toBe('0px');
        expect(frame.style.maxWidth, name).toBe(`${String(size.dialogMax)}px`);
        expect(screen.queryByTestId(`${STATES[state].testID}-grabber`), name).toBeNull();
      }
    }
    expect(errors).not.toHaveBeenCalled();
    expect(warnings).not.toHaveBeenCalled();
  });

  it('the fixtures hold the five states', () => {
    expect(Object.keys(STATES)).toEqual([...STATE_NAMES]);
    const preview: Readonly<Partial<Record<StateName, InteractionPreviewState>>> = PREVIEW;
    expect(preview).toEqual({});
    expect(GROUND).toEqual({});
    for (const state of STATE_NAMES) {
      const fixture: SheetProps = STATES[state];
      expect(fixture.open, state).toBe(true);
      expect(fixture.testID, state).toMatch(TEST_ID);
    }
    expect(STATES.half.detents).toEqual(['half', 'full']);
    expect(STATES.notDismissible.dismissible).toBe(false);
    expect('title' in STATES.openNoTitle).toBe(false);
  });

  it('is a dialog with its title at medium and expanded', () => {
    for (const viewport of [MEDIUM, EXPANDED]) {
      setViewport(viewport[0], viewport[1]);
      const frame = draw(STATES.open);
      expect(screen.getByRole('dialog', { name: 'Not interested?' })).toBe(frame);
      expect(frame.getAttribute('aria-modal')).toBe('true');
      // The title is the dialog's heading, and the footer follows the content.
      const heading = within(frame).getByRole('heading', { name: 'Not interested?' });
      const labelledBy = frame.getAttribute('aria-labelledby');
      expect(document.getElementById(labelledBy ?? '')?.contains(heading)).toBe(true);
      const content = within(frame).getByText('We will show fewer school board cards.');
      const footer = within(frame).getByTestId('gallery.sheet-open-show-fewer');
      expect(
        content.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        heading.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    // Without a title the frame draws no heading of its own: the first child carries one.
    setViewport(...MEDIUM);
    const untitled = draw(STATES.openNoTitle);
    expect(untitled.getAttribute('aria-labelledby')).toBeNull();
    expect(within(untitled).getAllByRole('heading')).toHaveLength(1);
    expect(within(untitled).getByRole('heading', { name: 'Sources' })).toBeDefined();
  });

  it('is a dialog with its title on a phone', () => {
    setViewport(...COMPACT);
    const frame = draw(STATES.open);
    expect(screen.getByRole('dialog', { name: 'Not interested?' })).toBe(frame);
    expect(frame.getAttribute('aria-modal')).toBe('true');
    const heading = within(frame).getByRole('heading', { name: 'Not interested?' });
    expect(within(frame).getByText('We will show fewer school board cards.')).toBeDefined();
    expect(within(frame).getByTestId('gallery.sheet-open-show-fewer')).toBeDefined();
    // The grabber, then the title, then the content.
    const grabber = screen.getByTestId('gallery.sheet-open-grabber');
    expect(
      grabber.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const untitled = draw(STATES.openNoTitle);
    expect(untitled.getAttribute('aria-labelledby')).toBeNull();
    expect(within(untitled).getAllByRole('heading')).toHaveLength(1);
  });

  it('the grabber is named Close and closes the sheet at compact', () => {
    setViewport(...COMPACT);
    const onClose = vi.fn<() => void>();
    const frame = draw({ ...STATES.open, onClose });
    const grabber = screen.getByTestId('gallery.sheet-open-grabber');
    expect(within(frame).getByRole('button', { name: 'Close' })).toBe(grabber);
    expect(grabber.contains(barOf(frame))).toBe(true);
    // Centered, a little under the top edge.
    expect(grabber.closest<HTMLElement>('[style*="align-items: center"]')?.style.paddingTop).toBe(
      `${String(space.x2)}px`,
    );
    fireEvent.click(grabber);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a sheet that is not dismissible has a grabber that takes no press', () => {
    setViewport(...COMPACT);
    const onClose = vi.fn<() => void>();
    const frame = draw({ ...STATES.notDismissible, onClose });
    expect(screen.queryByTestId('gallery.sheet-not-dismissible-grabber')).toBeNull();
    expect(within(frame).queryByRole('button', { name: 'Close' })).toBeNull();
    expect(barOf(frame).isConnected).toBe(true);
    pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the scrim closes it on a phone when dismissible, and never otherwise', () => {
    setViewport(...COMPACT);
    const onClose = vi.fn<() => void>();
    draw({ ...STATES.open, onClose });
    fireEvent.click(screen.getByTestId('gallery.sheet-open-scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(2);

    // A sheet that must be answered has no scrim to press and does not hear Escape.
    const stays = vi.fn<() => void>();
    const frame = draw({ ...STATES.notDismissible, onClose: stays });
    expect(screen.queryByTestId('gallery.sheet-not-dismissible-scrim')).toBeNull();
    pressEscape();
    expect(stays).not.toHaveBeenCalled();
    expect(frame.isConnected).toBe(true);
    expect(screen.getByTestId('gallery.sheet-not-dismissible-allow')).toBeDefined();
  });

  it('on a phone the scrim is the scrim token and the one dialog is named by the title', () => {
    setViewport(...COMPACT);
    for (const theme of ['light', 'dark'] as const) {
      const frame = draw(STATES.open, { theme });
      const scrim = scrimOf(frame);
      expect(scrim.style.backgroundColor, theme).toBe(written(color[theme].scrim));
      expect(scrim.style.position, theme).toBe('absolute');
      for (const edge of ['top', 'right', 'bottom', 'left'] as const) {
        expect(scrim.style[edge], `${theme} ${edge}`).toBe('0px');
      }
      // The frame stands over the scrim, and it is the only dialog with a name.
      expect(Number(frame.style.zIndex), theme).toBeGreaterThan(Number(scrim.style.zIndex));
      expect(screen.getAllByRole('dialog', { name: /./ }), theme).toEqual([frame]);
      expect(document.querySelectorAll('dialog'), theme).toHaveLength(0);
      expect(screen.queryByLabelText('Bottom sheet'), theme).toBeNull();
    }
    // Without a title the sheet takes no name from anywhere else.
    const untitled = draw(STATES.openNoTitle);
    expect(untitled.getAttribute('aria-label')).toBeNull();
    expect(screen.queryAllByRole('dialog', { name: /./ })).toEqual([]);
  });

  it('stands on the bottom edge as wide as the window, with its content clear of every inset', () => {
    setViewport(...COMPACT);
    const insets = { top: 59, right: 84, bottom: 34, left: 0 };
    cleanup();
    renderWithProviders(
      <SafeAreaInsetsContext.Provider value={insets}>
        <Sheet {...STATES.open} />
      </SafeAreaInsetsContext.Provider>,
    );
    const frame = screen.getByTestId('gallery.sheet-open');
    const window = frame.parentElement;
    // The frame is the last thing in a column that fills the window under the top inset.
    expect(window?.style.justifyContent).toBe('flex-end');
    expect(window?.style.paddingTop).toBe('59px');
    expect(window?.style.paddingLeft ?? '').toBe('');
    expect(window?.style.paddingRight ?? '').toBe('');
    expect(frame.style.marginLeft).toBe('');
    expect(frame.style.marginRight).toBe('');
    expect(frame.style.maxHeight).toBe('100%');
    // The rule on its top edge is the frame's own, so it runs the width of the sheet.
    expect(frame.style.borderTopWidth).toBe(`${String(rule.hairline)}px`);
    // The content keeps clear of the side inset and of the home indicator.
    expect(frame.style.paddingLeft).toBe(`${String(gutter.regular)}px`);
    expect(frame.style.paddingRight).toBe(`${String(gutter.regular + 84)}px`);
    expect(frame.style.paddingBottom).toBe(`${String(space.x6 + 34)}px`);
    // The grabber's row reaches back over the inset, so the bar is centered on the sheet.
    const row = barOf(frame).closest<HTMLElement>('[style*="align-items: center"]');
    expect(row?.parentElement).toBe(frame);
    expect(row?.style.marginLeft).toBe('0px');
    expect(row?.style.marginRight).toBe('-84px');
  });

  it('rests at the tallest of its detents', () => {
    setViewport(...COMPACT);
    // Nothing moves a sheet between its detents yet, so it takes the most room it is given.
    expect(draw(STATES.half).style.height).toBe('100%');
    expect(draw({ ...STATES.half, detents: ['full', 'half'] }).style.height).toBe('100%');
    expect(draw({ ...STATES.half, detents: ['half'] }).style.height).toBe('50%');
    expect(draw({ ...STATES.half, detents: ['content', 'half'] }).style.height).toBe('50%');
    expect(draw({ ...STATES.half, detents: ['full'] }).style.height).toBe('100%');
    const fitted = draw(STATES.open);
    expect(fitted.style.height).toBe('');
    expect(fitted.style.maxHeight).toBe('100%');
    // A sheet with a height of its own keeps its footer at its foot.
    const tall = draw({ ...STATES.withFooter, detents: ['full'] });
    let box: HTMLElement | null = within(tall).getByText('Soonest filing deadline first.');
    while (box !== null && box.parentElement !== tall) {
      box = box.parentElement;
    }
    expect(box?.style.flexGrow).toBe('1');
    const foot = within(tall).getByTestId('gallery.sheet-with-footer-apply');
    expect(
      (box?.compareDocumentPosition(foot) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('rises from under the bottom edge, and stays until it has gone back', () => {
    setViewport(...COMPACT);
    vi.useFakeTimers();
    cleanup();
    const view = renderWithProviders(<Sheet {...STATES.open} open={false} />);
    expect(screen.queryByTestId('gallery.sheet-open')).toBeNull();

    view.rerender(<Sheet {...STATES.open} />);
    const frame = screen.getByTestId('gallery.sheet-open');
    // Laid out its own height down, which is just under the bottom edge, and the scrim clear.
    expect(frame.style.transform).toBe('translateY(100%)');
    expect(frame.style.opacity).toBe('');
    expect(scrimOf(frame).style.opacity).toBe('0');
    act(() => {
      vi.advanceTimersByTime(motion.duration.sheet);
    });
    expect(frame.style.transform).toBe('translateY(0%)');
    expect(frame.style.opacity).toBe('');
    expect(scrimOf(frame).style.opacity).toBe('1');

    // It leaves by its own height, and is gone when that has run.
    view.rerender(<Sheet {...STATES.open} open={false} />);
    expect(frame.style.transform).toBe('translateY(100%)');
    expect(scrimOf(frame).style.opacity).toBe('0');
    act(() => {
      vi.advanceTimersByTime(motion.duration.sheet - 1);
    });
    expect(screen.queryByTestId('gallery.sheet-open')).toBe(frame);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.queryByTestId('gallery.sheet-open')).toBeNull();
    vi.useRealTimers();
  });

  it('under reduced motion it fades and does not rise', () => {
    setViewport(...COMPACT);
    vi.useFakeTimers();
    cleanup();
    const view = renderWithProviders(<Sheet {...STATES.open} />, { reducedMotion: true });
    const frame = screen.getByTestId('gallery.sheet-open');
    expect(frame.style.opacity).toBe('0');
    expect(frame.style.transform).toBe('');
    act(() => {
      vi.advanceTimersByTime(motion.duration.sheet);
    });
    expect(frame.style.opacity).toBe('1');
    expect(frame.style.transform).toBe('');
    view.rerender(<Sheet {...STATES.open} open={false} />);
    expect(frame.style.opacity).toBe('0');
    expect(frame.style.transform).toBe('');
    vi.useRealTimers();
  });

  it('Escape closes it when dismissible', () => {
    setViewport(...MEDIUM);
    const onClose = vi.fn<() => void>();
    draw({ ...STATES.open, onClose });
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('gallery.sheet-open-scrim'));
    expect(onClose).toHaveBeenCalledTimes(2);

    const stays = vi.fn<() => void>();
    draw({ ...STATES.notDismissible, onClose: stays });
    pressEscape();
    expect(stays).not.toHaveBeenCalled();
    expect(screen.queryByTestId('gallery.sheet-not-dismissible-scrim')).toBeNull();
  });

  it('a second sheet closes the first', () => {
    for (const viewport of [COMPACT, EXPANDED]) {
      setViewport(viewport[0], viewport[1]);
      const closeFirst = vi.fn<() => void>();
      const closeSecond = vi.fn<() => void>();
      function Two({ second }: { second: boolean }): JSX.Element {
        return (
          <>
            <Sheet {...STATES.open} onClose={closeFirst} />
            <Sheet {...STATES.withFooter} open={second} onClose={closeSecond} />
          </>
        );
      }
      cleanup();
      const view = renderWithProviders(<Two second={false} />);
      expect(closeFirst, String(viewport[0])).not.toHaveBeenCalled();
      view.rerender(<Two second={true} />);
      expect(closeFirst, String(viewport[0])).toHaveBeenCalledTimes(1);
      expect(closeSecond, String(viewport[0])).not.toHaveBeenCalled();
    }
  });

  it('single-key shortcuts wait while it is open', () => {
    for (const viewport of [COMPACT, EXPANDED]) {
      setViewport(viewport[0], viewport[1]);
      const onKey = vi.fn<() => void>();
      function Page({ open }: { open: boolean }): JSX.Element {
        return (
          <>
            <Shortcut onKey={onKey} />
            <Sheet {...STATES.open} open={open} />
          </>
        );
      }
      cleanup();
      const view = renderWithProviders(<Page open={true} />);
      emit(keyEvent('j'));
      expect(onKey, String(viewport[0])).not.toHaveBeenCalled();
      view.rerender(<Page open={false} />);
      emit(keyEvent('j'));
      expect(onKey, String(viewport[0])).toHaveBeenCalledTimes(1);
    }
  });
});
