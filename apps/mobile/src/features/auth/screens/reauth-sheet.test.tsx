import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/auth/view-models/reauth.fixtures';
import type { ReauthViewModel } from '@/features/auth/view-models/reauth.types';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { motion } from '@/ui/motion';

import { ReauthSheet } from './reauth-sheet';

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
// A drawing of the app loads no asset, so a call fails the test.
vi.mock('react-native-svg/lib/module/lib/resolveAssetUri', () => ({
  resolveAssetUri: (): never => {
    throw new Error('a drawing of the app loads no asset');
  },
}));

const FIXTURES: Readonly<Record<string, ReauthViewModel>> = fixtures;
const SHEET = 'auth.reauth-sheet';
const TITLE = 'Sign in again to continue';
const COMPACT = [390, 844] as const;
const EXPANDED = [1440, 900] as const;
/** The time the fixtures are written at: a code fixture may be sent again 30 seconds later. */
const FIXTURE_TIME = Date.parse('2027-01-15T12:00:00.000Z');

type Code = NonNullable<ReauthViewModel['code']>;

/** Renders the sheet from one view-model, in place of whatever was drawn before. */
function draw(vm: ReauthViewModel, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<ReauthSheet vm={vm} />, options);
  return screen.getByTestId(SHEET);
}

/** Draws the sheet again from a new view-model in the same place, as the hook does. */
let redraw: (vm: ReauthViewModel) => void = () => undefined;

function hold(vm: ReauthViewModel): HTMLElement {
  cleanup();
  const view = renderWithProviders(<ReauthSheet vm={vm} />);
  redraw = (next) => {
    view.rerender(<ReauthSheet vm={next} />);
  };
  return screen.getByTestId(SHEET);
}

function withCode(code: Partial<Code>): ReauthViewModel {
  return { ...fixtures.reauthCode, code: { ...fixtures.reauthCode.code, ...code } };
}

function isDisabled(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') === 'true';
}

function isBusy(element: HTMLElement): boolean {
  return element.getAttribute('aria-busy') === 'true';
}

function codeField(): HTMLInputElement {
  const input = screen.getByTestId('auth.code-field');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('the code field is not an input');
  }
  return input;
}

/** A press and release of Escape, as a key press sends them to the page. */
function pressEscape(): void {
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.keyUp(document, { key: 'Escape' });
}

/** Lets a sheet that was closed leave the page. */
function leave(): void {
  act(() => {
    vi.advanceTimersByTime(Math.max(motion.duration.sheet, motion.duration.fade) + 100);
  });
}

beforeEach(() => {
  // A code fixture counts its wait from the fixtures' own time.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  vi.setSystemTime(FIXTURE_TIME);
  setViewport(...COMPACT);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setViewport(...COMPACT);
});

describe('ReauthSheet', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(5);
    for (const [width, height] of [
      [360, 740],
      [430, 932],
      [820, 1180],
      [1440, 900],
    ] as const) {
      setViewport(width, height);
      for (const [name, vm] of Object.entries(FIXTURES)) {
        for (const theme of ['light', 'dark'] as const) {
          const sheet = draw(vm, { theme });
          // The sheet is a dialog named by its title, and says why it asks.
          expect(screen.getByRole('dialog', { name: TITLE }), name).toBe(sheet);
          expect(within(sheet).getByText('This keeps your account safe.'), name).toBeTruthy();
          expect(sheet.textContent, name).not.toContain('{{');
          expect(sheet.textContent, name).not.toContain('<');
          // The options and the code are never on screen together.
          const options = within(sheet).queryByTestId('auth.reauth-email') !== null;
          const code = within(sheet).queryByTestId('auth.code-field') !== null;
          expect(options, name).toBe(vm.code === null);
          expect(code, name).toBe(vm.code !== null);
          // A phone has the grabber; a window has the dialog's frame and none.
          expect(screen.queryByTestId(`${SHEET}-grabber`) !== null, name).toBe(width < 600);
        }
      }
    }
  });

  it('methods follow the account', () => {
    // An account that signs in by email alone is offered the code alone, whatever the device offers.
    const emailOnly = draw({ ...fixtures.reauthMethods, methods: ['email'] });
    expect(within(emailOnly).queryByTestId('auth.apple-button')).toBeNull();
    expect(within(emailOnly).queryByTestId('auth.google-button')).toBeNull();
    expect(within(emailOnly).getByTestId('auth.reauth-email').textContent).toBe('Email me a code');

    const onSendCode = vi.fn<() => void>();
    const sheet = draw({ ...fixtures.reauthMethods, onSendCode });
    const offered = ['auth.apple-button', 'auth.google-button', 'auth.reauth-email'];
    const options = [...sheet.querySelectorAll('[data-testid]')]
      .map((element) => element.getAttribute('data-testid') ?? '')
      .filter((id) => offered.includes(id));
    expect(options).toEqual(['auth.apple-button', 'auth.reauth-email']);
    expect(within(sheet).getByTestId('auth.apple-button').getAttribute('aria-label')).toBe(
      'Continue with Apple',
    );
    // The email option sends to the account's own address: the sheet asks for none.
    expect(sheet.querySelectorAll('input')).toHaveLength(0);
    const email = within(sheet).getByTestId('auth.reauth-email');
    expect(screen.getByRole('button', { name: 'Email me a code' })).toBe(email);
    expect(isDisabled(email)).toBe(false);
    fireEvent.click(email);
    expect(onSendCode).toHaveBeenCalledTimes(1);

    // A provider the account does not sign in with is not offered, though the device offers it.
    const google = draw({
      ...fixtures.reauthMethods,
      methods: ['email', 'google'],
      googleButton: fixtures.reauthMethods.appleButton,
    });
    expect(within(google).queryByTestId('auth.apple-button')).toBeNull();
    expect(within(google).getByTestId('auth.google-button')).toBeTruthy();
  });

  it('an account with no address is offered no code', () => {
    const sheet = draw({ ...fixtures.reauthMethods, methods: ['apple'] });
    expect(within(sheet).getByTestId('auth.apple-button').getAttribute('aria-label')).toBe(
      'Continue with Apple',
    );
    expect(within(sheet).queryByTestId('auth.reauth-email')).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Email me a code' })).toBeNull();
  });

  it('busy and sending', () => {
    const onSendCode = vi.fn<() => void>();
    const busy = draw({ ...fixtures.reauthBusy, onSendCode });
    const withheld = within(busy).getByTestId('auth.reauth-email');
    expect(isDisabled(withheld)).toBe(true);
    // The words stay: only the press is withheld while a sign-in is under way.
    expect(withheld.textContent).toBe('Email me a code');
    fireEvent.click(withheld);
    expect(onSendCode).not.toHaveBeenCalled();

    const sending = draw({ ...fixtures.reauthMethods, emailStatus: 'sending', onSendCode });
    expect(isBusy(within(sending).getByTestId('auth.reauth-email'))).toBe(true);
    fireEvent.click(within(sending).getByTestId('auth.reauth-email'));
    expect(onSendCode).not.toHaveBeenCalled();
  });

  it('code after sending', () => {
    const onSubmit = vi.fn<(code: string) => void>();
    const sheet = hold(withCode({ onSubmit }));
    // The six boxes stand in place of the options.
    expect(within(sheet).queryByTestId('auth.reauth-email')).toBeNull();
    expect(within(sheet).queryByTestId('auth.apple-button')).toBeNull();
    expect(sheet.textContent).toContain('fixture@example.test');
    expect(within(sheet).getByTestId('auth.code-resend-live').textContent).toBe(
      'Send again in 30 seconds',
    );
    const verify = within(sheet).getByTestId('auth.code-verify');
    expect(isDisabled(verify)).toBe(true);
    expect(verify.textContent).toBe('Enter the 6 digits');

    // The field sends the code itself when its sixth digit lands, and the button sends it too.
    fireEvent.change(codeField(), { target: { value: '123456' } });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenLastCalledWith('123456');
    expect(isDisabled(verify)).toBe(false);
    expect(verify.textContent).toBe('Verify');
    fireEvent.click(verify);
    expect(onSubmit).toHaveBeenCalledTimes(2);
    expect(onSubmit).toHaveBeenLastCalledWith('123456');

    redraw(withCode({ onSubmit, status: 'checking' }));
    expect(isBusy(within(sheet).getByTestId('auth.code-verify'))).toBe(true);
    expect(codeField().value).toBe('123456');

    // A code that turned out wrong is typed again from the first box.
    redraw(withCode({ onSubmit, status: 'wrong' }));
    expect(codeField().value).toBe('');
    expect(sheet.textContent).toContain('That code is not right. Try again.');
    expect(within(sheet).getByTestId('auth.code-verify').textContent).toBe('Enter the 6 digits');
  });

  it('a wrong code fixture and a spent code', () => {
    const wrong = draw(fixtures.reauthCodeWrong);
    expect(wrong.textContent).toContain('That code is not right. Try again.');

    const onSubmit = vi.fn<(code: string) => void>();
    const locked = draw(withCode({ onSubmit, status: 'locked' }));
    expect(locked.textContent).toContain('Too many tries. Send a new code.');
    const verify = within(locked).getByTestId('auth.code-verify');
    expect(isDisabled(verify)).toBe(true);
    fireEvent.click(verify);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('nothing typed outlives its code', () => {
    const sheet = hold(fixtures.reauthCode);
    fireEvent.change(codeField(), { target: { value: '123' } });
    expect(codeField().value).toBe('123');
    // The person asks for a different way; the next code starts from empty boxes.
    redraw(fixtures.reauthMethods);
    expect(within(sheet).queryByTestId('auth.code-field')).toBeNull();
    redraw(fixtures.reauthCode);
    expect(codeField().value).toBe('');

    // A sheet that was closed keeps none of it either.
    fireEvent.change(codeField(), { target: { value: '45' } });
    redraw({ ...fixtures.reauthCode, open: false });
    leave();
    expect(screen.queryByTestId(SHEET)).toBeNull();
    redraw(fixtures.reauthCode);
    expect(codeField().value).toBe('');
  });

  it('mismatch', () => {
    const sheet = draw(fixtures.reauthMismatch);
    const alert = within(sheet).getByRole('alert');
    expect(alert.textContent).toBe(
      'That is a different account. Sign in with the one you are using.',
    );
    // The notice stands above the options it is about, which stay offered.
    const email = within(sheet).getByTestId('auth.reauth-email');
    expect(alert.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(isDisabled(email)).toBe(false);
    // No fixture without a refusal says anything.
    draw(fixtures.reauthMethods);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closes', () => {
    const onClose = vi.fn<() => void>();
    // A phone: the grabber is the close control.
    const sheet = draw({ ...fixtures.reauthMethods, onClose });
    const grabber = screen.getByTestId(`${SHEET}-grabber`);
    expect(within(sheet).getByRole('button', { name: 'Close' })).toBe(grabber);
    fireEvent.click(grabber);
    expect(onClose).toHaveBeenCalledTimes(1);
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(2);

    // A window: the dialog closes on Escape, with the code stage as with the options.
    setViewport(...EXPANDED);
    draw({ ...fixtures.reauthCode, onClose });
    expect(screen.queryByTestId(`${SHEET}-grabber`)).toBeNull();
    pressEscape();
    expect(onClose).toHaveBeenCalledTimes(3);

    // A closed sheet draws nothing.
    cleanup();
    renderWithProviders(<ReauthSheet vm={{ ...fixtures.reauthMethods, open: false }} />);
    expect(screen.queryByTestId(SHEET)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
