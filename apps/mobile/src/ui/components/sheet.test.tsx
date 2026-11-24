import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { JSX } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { linksFake } from '@/test/platform/links';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { useShortcut } from '@/ui/shortcuts';
import type { KeyEventLike } from '@/ui/shortcuts';
import { color, gutter, rule, size, space } from '@/ui/tokens';

import type { InteractionPreviewState } from './pressable';
import { Sheet } from './sheet';
import type { SheetProps } from './sheet';
import { GROUND, PREVIEW, STATES } from './sheet.fixtures';

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
    fireEvent.click(screen.getByTestId('expo-ui-bottom-sheet-overlay'));
    expect(onClose).toHaveBeenCalledTimes(1);

    // A sheet that must be answered is shown again when the platform lets it go.
    const stays = vi.fn<() => void>();
    draw({ ...STATES.notDismissible, onClose: stays });
    fireEvent.click(screen.getByTestId('expo-ui-bottom-sheet-overlay'));
    expect(stays).not.toHaveBeenCalled();
    expect(screen.getByTestId('gallery.sheet-not-dismissible').isConnected).toBe(true);
    expect(screen.getByTestId('gallery.sheet-not-dismissible-allow')).toBeDefined();
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
