import { STATE_CODES } from '@citizenrun/shared';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/auth/view-models/sign-in.fixtures';
import type { SignInViewModel } from '@/features/auth/view-models/sign-in.types';
import type * as Navigation from '@/lib/navigation';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';
import { motion } from '@/ui/motion';

import { SignInScreenView } from './sign-in-screen';

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

// Where the screen that stands in place of sign-in leads; the test stands in for the router.
const navigation = vi.hoisted(() => ({ navigateTo: vi.fn<(path: string) => void>() }));

vi.mock('@/lib/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof Navigation>()),
  navigateTo: navigation.navigateTo,
}));

const FIXTURES: Readonly<Record<string, SignInViewModel>> = fixtures;
const ROOT = 'auth.sign-in';
const BACK = 'shell.app-bar-back';
/** The time the fixtures are written at: a code fixture may be sent again 30 seconds later. */
const FIXTURE_TIME = Date.parse('2027-01-15T12:00:00.000Z');
const STEP = 'Step 1 of 5';
const AI_SENTENCE =
  'Public posts, comments and bios may be checked by an automated AI service run by Anthropic; direct messages never are.';

type Code = NonNullable<SignInViewModel['code']>;

/** Renders the screen from one view-model, in place of whatever was drawn before. */
function draw(vm: SignInViewModel, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<SignInScreenView vm={vm} />, options);
  return screen.getByTestId(ROOT);
}

/** Draws the screen again from a new view-model in the same place, as the hook does. */
let redraw: (vm: SignInViewModel) => void = () => undefined;

function hold(vm: SignInViewModel): HTMLElement {
  cleanup();
  const view = renderWithProviders(<SignInScreenView vm={vm} />);
  redraw = (next) => {
    view.rerender(<SignInScreenView vm={next} />);
  };
  return screen.getByTestId(ROOT);
}

function withCode(base: SignInViewModel, code: Partial<Code>): SignInViewModel {
  return { ...base, code: { ...fixtures.signInCode.code, ...code } };
}

function button(testID: string): HTMLElement {
  return screen.getByTestId(testID);
}

function isDisabled(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') === 'true';
}

function isBusy(element: HTMLElement): boolean {
  return element.getAttribute('aria-busy') === 'true';
}

function field(testID: string): HTMLInputElement {
  const input = screen.getByTestId(testID);
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`${testID} is not an input`);
  }
  return input;
}

function type(testID: string, value: string): void {
  fireEvent.change(field(testID), { target: { value } });
}

function title(): string {
  const headings = screen.getAllByRole('heading', { level: 1 });
  expect(headings).toHaveLength(1);
  return headings[0]?.textContent ?? '';
}

/** Lets a sheet or a list that was closed leave the page. */
function leave(): void {
  act(() => {
    vi.advanceTimersByTime(Math.max(motion.duration.sheet, motion.duration.fade) + 100);
  });
}

function tick(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  navigation.navigateTo.mockClear();
  // A code fixture counts its wait from the fixtures' own time.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
  vi.setSystemTime(FIXTURE_TIME);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setViewport(390, 844);
});

describe('SignInScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES)).toHaveLength(23);
    for (const [width, height] of [
      [360, 740],
      [430, 932],
      [820, 1180],
      [1440, 900],
    ] as const) {
      setViewport(width, height);
      for (const [name, vm] of Object.entries(FIXTURES)) {
        for (const theme of ['light', 'dark'] as const) {
          cleanup();
          const view = renderWithProviders(<SignInScreenView vm={vm} />, { theme });
          const text = view.container.textContent;
          expect(text, name).not.toBe('');
          expect(text, name).not.toContain('{{');
          expect(text, name).not.toContain('<');
          // One heading per stage, and per screen that stands in its place.
          expect(screen.getAllByRole('heading', { level: 1 }), name).toHaveLength(1);
        }
      }
    }
  });

  it('methods order and names', () => {
    const root = draw(fixtures.signInMethods);
    expect(title()).toBe('Sign in or create an account');
    const offered = ['auth.apple-button', 'auth.google-button', 'auth.email-option'];
    const options = [...root.querySelectorAll('[data-testid]')]
      .map((element) => element.getAttribute('data-testid') ?? '')
      .filter((id) => offered.includes(id));
    expect(options).toEqual(['auth.apple-button', 'auth.google-button', 'auth.email-option']);
    expect(button('auth.apple-button').getAttribute('aria-label')).toBe('Continue with Apple');
    expect(button('auth.google-button').getAttribute('aria-label')).toBe('Continue with Google');
    const email = button('auth.email-option');
    expect(screen.getByRole('button', { name: 'Continue with email' })).toBe(email);
    expect(isDisabled(email)).toBe(false);
    // The stage has no button of its own under the options, and nothing is said before it is asked.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(root.querySelectorAll('input')).toHaveLength(0);

    const onChooseEmail = vi.fn<() => void>();
    const onBack = vi.fn<() => void>();
    draw({ ...fixtures.signInMethods, onChooseEmail, onBack });
    fireEvent.click(button('auth.email-option'));
    expect(onChooseEmail).toHaveBeenCalledTimes(1);
    fireEvent.click(button(BACK));
    expect(onBack).toHaveBeenCalledTimes(1);

    // Where neither provider is offered, email is the one option.
    const emailOnly = draw(fixtures.signInMethodsEmailOnly);
    expect(screen.queryByTestId('auth.apple-button')).toBeNull();
    expect(screen.queryByTestId('auth.google-button')).toBeNull();
    expect(within(emailOnly).getByTestId('auth.email-option').textContent).toBe(
      'Continue with email',
    );
    // One provider alone keeps its place above email.
    draw({ ...fixtures.signInMethods, appleButton: null });
    expect(screen.queryByTestId('auth.apple-button')).toBeNull();
    expect(button('auth.google-button')).toBeTruthy();
  });

  it('methods name the terms and the privacy policy under the options', () => {
    for (const [name, vm] of [
      ['signInMethods', fixtures.signInMethods],
      ['signInMethodsEmailOnly', fixtures.signInMethodsEmailOnly],
      ['signInMethodsBusy', fixtures.signInMethodsBusy],
      ['signInMethodsNotice', fixtures.signInMethodsNotice],
    ] as const) {
      const root = draw(vm);
      const terms = screen.getByTestId('auth.methods-terms');
      const privacy = screen.getByTestId('auth.methods-privacy');
      // One small line, whole, with a link on each document's name.
      let line = terms.parentElement;
      while (line !== null && !line.contains(privacy)) {
        line = line.parentElement;
      }
      expect(line?.textContent, name).toBe('Terms · Privacy policy');
      expect(root.contains(line), name).toBe(true);
      expect(terms.getAttribute('href'), name).toBe('https://example.test/terms');
      expect(terms.getAttribute('target'), name).toBe('_blank');
      expect(screen.getByRole('link', { name: 'Terms, opens in your browser' }), name).toBe(terms);
      expect(privacy.getAttribute('href'), name).toBe('https://example.test/privacy');
      expect(privacy.getAttribute('target'), name).toBe('_blank');
      expect(
        screen.getByRole('link', { name: 'Privacy policy, opens in your browser' }),
        name,
      ).toBe(privacy);
      // The line stands under the last option, the terms before the privacy policy.
      const email = button('auth.email-option');
      expect(
        email.compareDocumentPosition(terms) & Node.DOCUMENT_POSITION_FOLLOWING,
        name,
      ).not.toBe(0);
      expect(
        terms.compareDocumentPosition(privacy) & Node.DOCUMENT_POSITION_FOLLOWING,
        name,
      ).not.toBe(0);
    }
    // The line is the methods stage's own: no later stage draws it.
    draw(fixtures.signInEmail);
    expect(screen.queryByTestId('auth.methods-terms')).toBeNull();
    expect(screen.queryByTestId('auth.methods-privacy')).toBeNull();
  });

  it('busy', () => {
    const onChooseEmail = vi.fn<() => void>();
    draw({ ...fixtures.signInMethodsBusy, onChooseEmail });
    const email = button('auth.email-option');
    expect(isDisabled(email)).toBe(true);
    // The words stay: only the press is withheld while a sign-in is under way.
    expect(email.textContent).toBe('Continue with email');
    fireEvent.click(email);
    expect(onChooseEmail).not.toHaveBeenCalled();
    expect(button('auth.apple-button')).toBeTruthy();
    expect(button('auth.google-button')).toBeTruthy();
  });

  it('notices', () => {
    draw(fixtures.signInMethodsNotice);
    expect(screen.getByRole('alert').textContent).toBe(
      "This account is being deleted, so you can't sign in to it.",
    );
    // The notice stands above the options it is about.
    const alert = screen.getByRole('alert');
    expect(
      alert.compareDocumentPosition(button('auth.email-option')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

    draw({
      ...fixtures.signInMethods,
      notice: { code: 'provider_unavailable', retryAfterSeconds: null },
    });
    expect(screen.getByRole('alert').textContent).toBe(
      "This sign-in option isn't available right now. Try another way to sign in.",
    );

    // Something to do elsewhere, not a failure: said without an alarm.
    draw({
      ...fixtures.signInMethods,
      notice: { code: 'age_signal_required', retryAfterSeconds: null },
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe(
      'Confirm your age in the phone app to continue.',
    );

    draw({ ...fixtures.signInMethods, notice: { code: 'generic', retryAfterSeconds: null } });
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong. Try again.');

    draw({ ...fixtures.signInMethods, notice: { code: 'rate_limited', retryAfterSeconds: 60 } });
    expect(screen.getByRole('alert').textContent).toBe(
      'Too many tries in a short time. Wait a moment and try again.',
    );
  });

  it('email waits for an address', () => {
    const onSubmit = vi.fn<(email: string) => void>();
    draw({ ...fixtures.signInEmail, email: { ...fixtures.signInEmail.email, onSubmit } });
    expect(title()).toBe('What is your email?');
    const input = field('auth.email-field');
    expect(input.value).toBe('');
    // The field is where the stage starts.
    expect(document.activeElement).toBe(input);
    expect(input.getAttribute('type')).toBe('email');
    expect(screen.getByLabelText('Email')).toBe(input);

    const proceed = button('auth.email-continue');
    expect(isDisabled(proceed)).toBe(true);
    expect(proceed.textContent).toBe('Enter your email');
    fireEvent.click(proceed);
    fireEvent.keyDown(input, { key: 'Enter' });

    for (const partial of ['a', 'a@', 'a@example', '@example.test', 'a example@example.test']) {
      type('auth.email-field', partial);
      expect(isDisabled(button('auth.email-continue')), partial).toBe(true);
      expect(button('auth.email-continue').textContent, partial).toBe('Enter your email');
    }
    fireEvent.click(button('auth.email-continue'));
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();

    type('auth.email-field', 'a@example.test');
    expect(isDisabled(button('auth.email-continue'))).toBe(false);
    expect(button('auth.email-continue').textContent).toBe('Continue');
    fireEvent.click(button('auth.email-continue'));
    expect(onSubmit.mock.calls).toEqual([['a@example.test']]);

    // The keyboard's own key sends it too, and spaces around an address are not part of it.
    type('auth.email-field', '  a@example.test ');
    fireEvent.keyDown(field('auth.email-field'), { key: 'Enter' });
    expect(onSubmit.mock.calls).toEqual([['a@example.test'], ['a@example.test']]);
  });

  it('a code on its way takes no second press', () => {
    const onSubmit = vi.fn<(email: string) => void>();
    hold({ ...fixtures.signInEmail, email: { ...fixtures.signInEmail.email, onSubmit } });
    type('auth.email-field', 'a@example.test');
    redraw({
      ...fixtures.signInEmailSending,
      email: { ...fixtures.signInEmailSending.email, onSubmit },
    });
    // What was typed stays while the code is sent.
    expect(field('auth.email-field').value).toBe('a@example.test');
    const proceed = button('auth.email-continue');
    expect(isBusy(proceed)).toBe(true);
    fireEvent.click(proceed);
    fireEvent.keyDown(field('auth.email-field'), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('email errors on the field', () => {
    const root = draw(fixtures.signInEmailError);
    const sentence = "We can't send email to that address. Use another one.";
    expect(screen.getByRole('alert').textContent).toBe(sentence);
    // On the field, not in a notice over the stage.
    expect(within(root).getAllByText(sentence)).toHaveLength(1);

    draw({
      ...fixtures.signInEmail,
      email: { ...fixtures.signInEmail.email, errorCode: 'rate_limited', retryAfterSeconds: 120 },
    });
    expect(screen.getByRole('alert').textContent).toBe(
      'Too many tries in a short time. Wait a moment and try again.',
    );
    draw({
      ...fixtures.signInEmail,
      email: { ...fixtures.signInEmail.email, errorCode: 'email_signin_paused' },
    });
    expect(screen.getByRole('alert').textContent).not.toBe('');
    draw(fixtures.signInEmail);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('code submits at six digits', () => {
    const onSubmit = vi.fn<(code: string) => void>();
    const root = draw(withCode(fixtures.signInCode, { onSubmit }));
    expect(title()).toBe('Enter the code');
    expect(
      within(root).getByText(
        'We sent a 6-digit code to fixture@example.test. It works for 10 minutes.',
      ),
    ).toBeTruthy();
    const verify = button('auth.code-verify');
    expect(isDisabled(verify)).toBe(true);
    expect(verify.textContent).toBe('Enter the 6 digits');
    fireEvent.click(verify);

    type('auth.code-field', '12345');
    expect(isDisabled(button('auth.code-verify'))).toBe(true);
    expect(button('auth.code-verify').textContent).toBe('Enter the 6 digits');
    expect(onSubmit).not.toHaveBeenCalled();

    // The sixth digit sends the code: nobody has to find the button.
    type('auth.code-field', '123456');
    expect(onSubmit.mock.calls).toEqual([['123456']]);
    expect(isDisabled(button('auth.code-verify'))).toBe(false);
    expect(button('auth.code-verify').textContent).toBe('Verify');
    // The button sends the same six digits for a person who presses it.
    fireEvent.click(button('auth.code-verify'));
    expect(onSubmit.mock.calls).toEqual([['123456'], ['123456']]);
  });

  it('wrong clears the boxes', () => {
    hold(fixtures.signInCode);
    type('auth.code-field', '123456');
    redraw(fixtures.signInCodeChecking);
    // While the code is checked the digits stay and the button waits.
    expect(field('auth.code-field').value).toBe('123456');
    expect(isBusy(button('auth.code-verify'))).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();

    redraw(fixtures.signInCodeWrong);
    expect(field('auth.code-field').value).toBe('');
    expect(screen.getByRole('alert').textContent).toBe('That code is not right. Try again.');
    expect(isDisabled(button('auth.code-verify'))).toBe(true);
    expect(button('auth.code-verify').textContent).toBe('Enter the 6 digits');

    // The next try is typed into the same field, and is not emptied a second time.
    type('auth.code-field', '654');
    expect(field('auth.code-field').value).toBe('654');
  });

  it('locked and expired', () => {
    for (const [vm, sentence] of [
      [fixtures.signInCodeLocked, 'Too many tries. Send a new code.'],
      [fixtures.signInCodeExpired, 'That code has expired. Send a new one.'],
    ] as const) {
      const onSubmit = vi.fn<(code: string) => void>();
      const onResend = vi.fn<() => void>();
      const onChangeEmail = vi.fn<() => void>();
      // Half a minute after the code was sent, so a new one may be asked for.
      vi.setSystemTime(FIXTURE_TIME + 30_000);
      draw(withCode(vm, { status: vm.code.status, onSubmit, onResend, onChangeEmail }));
      expect(screen.getByRole('alert').textContent, sentence).toBe(sentence);
      // The field takes no more digits, and the button sends nothing.
      const input = field('auth.code-field');
      expect(input.readOnly || input.disabled, sentence).toBe(true);
      const verify = button('auth.code-verify');
      expect(isDisabled(verify), sentence).toBe(true);
      expect(verify.textContent, sentence).toBe('Verify');
      fireEvent.click(verify);
      expect(onSubmit, sentence).not.toHaveBeenCalled();
      // Both ways on stay open.
      const resend = button('auth.code-resend-live');
      expect(resend.textContent, sentence).toBe('Send again');
      fireEvent.click(resend);
      expect(onResend, sentence).toHaveBeenCalledTimes(1);
      fireEvent.click(button('auth.code-change-email'));
      expect(onChangeEmail, sentence).toHaveBeenCalledTimes(1);
      vi.setSystemTime(FIXTURE_TIME);
    }
  });

  it('resend counts down', () => {
    const onResend = vi.fn<() => void>();
    vi.setSystemTime(FIXTURE_TIME + 27_000);
    draw(withCode(fixtures.signInCode, { onResend }));
    const resend = (): HTMLElement => button('auth.code-resend-live');
    expect(resend().textContent).toBe('Send again in 3 seconds');
    expect(isDisabled(resend())).toBe(true);
    fireEvent.click(resend());
    expect(onResend).not.toHaveBeenCalled();
    tick(1000);
    expect(resend().textContent).toBe('Send again in 2 seconds');
    tick(1000);
    expect(resend().textContent).toBe('Send again in 1 second');
    expect(isDisabled(resend())).toBe(true);
    tick(1000);
    expect(resend().textContent).toBe('Send again');
    expect(isDisabled(resend())).toBe(false);
    // Nothing keeps counting once there is nothing to count.
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(resend());
    expect(onResend).toHaveBeenCalledTimes(1);

    // A new code on its way.
    draw(withCode(fixtures.signInCode, { resendStatus: 'sending', onResend }));
    tick(30_000);
    expect(isBusy(resend())).toBe(true);
    fireEvent.click(resend());
    expect(onResend).toHaveBeenCalledTimes(1);

    // Too many codes: the wait is said in minutes, rounded up, and the press is withheld.
    draw(
      withCode(fixtures.signInCodeResendLimited, {
        resendStatus: 'limited',
        resendRetryAfterSeconds: 900,
        onResend,
      }),
    );
    expect(resend().textContent).toBe('Too many codes. Try again in 15 minutes.');
    expect(isDisabled(resend())).toBe(true);
    draw(
      withCode(fixtures.signInCode, {
        resendStatus: 'limited',
        resendRetryAfterSeconds: 61,
        onResend,
      }),
    );
    expect(resend().textContent).toBe('Too many codes. Try again in 2 minutes.');
    draw(
      withCode(fixtures.signInCode, {
        resendStatus: 'limited',
        resendRetryAfterSeconds: null,
        onResend,
      }),
    );
    expect(resend().textContent).toBe(
      'Too many tries in a short time. Wait a moment and try again.',
    );
    expect(isDisabled(resend())).toBe(true);
    fireEvent.click(resend());
    expect(onResend).toHaveBeenCalledTimes(1);
  });

  it('a different email leads back', () => {
    const onChangeEmail = vi.fn<() => void>();
    draw(withCode(fixtures.signInCode, { onChangeEmail }));
    const change = button('auth.code-change-email');
    expect(change.textContent).toBe('Use a different email');
    fireEvent.click(change);
    expect(onChangeEmail).toHaveBeenCalledTimes(1);
  });

  it('the date-of-birth step', () => {
    const onSubmit = vi.fn<(birth: { year: number; month: number }) => void>();
    const vm: SignInViewModel = {
      ...fixtures.signInAgeGate,
      ageGate: { ...fixtures.signInAgeGate.ageGate, onSubmit },
    };
    const { thisYear } = fixtures.signInAgeGate.ageGate;
    const born = thisYear - 30;
    const root = draw(vm);
    expect(title()).toBe('When were you born?');
    // Nothing is chosen for the person.
    const month = button('onboarding.age-month');
    const year = button('onboarding.age-year');
    expect(within(month).getByText('Pick a month')).toBeTruthy();
    expect(within(year).getByText('Pick a year')).toBeTruthy();
    const proceed = (): HTMLElement => button('onboarding.age-continue');
    expect(isDisabled(proceed())).toBe(true);
    expect(proceed().textContent).toBe('Pick a month and a year');
    fireEvent.click(proceed());
    expect(onSubmit).not.toHaveBeenCalled();
    // Nothing on the screen says which answer passes.
    for (const word of ['18', 'adult', 'older', 'younger']) {
      expect(root.textContent.toLowerCase(), word).not.toContain(word);
    }

    fireEvent.click(month);
    // Every year a living person was born in, the newest first, and no year after this one.
    fireEvent.click(screen.getByTestId('onboarding.age-month-options-3'));
    leave();
    expect(within(button('onboarding.age-month')).getByText('March')).toBeTruthy();
    // One answer of two is not an answer.
    expect(isDisabled(proceed())).toBe(true);
    expect(proceed().textContent).toBe('Pick a month and a year');

    fireEvent.click(button('onboarding.age-year'));
    expect(screen.queryByTestId(`onboarding.age-year-options-${String(thisYear + 1)}`)).toBeNull();
    expect(screen.getByTestId(`onboarding.age-year-options-${String(thisYear)}`)).toBeTruthy();
    expect(
      screen.getByTestId(`onboarding.age-year-options-${String(thisYear - 120)}`),
    ).toBeTruthy();
    expect(
      screen.queryByTestId(`onboarding.age-year-options-${String(thisYear - 121)}`),
    ).toBeNull();
    fireEvent.click(screen.getByTestId(`onboarding.age-year-options-${String(born)}`));
    leave();
    expect(within(button('onboarding.age-year')).getByText(String(born))).toBeTruthy();
    expect(isDisabled(proceed())).toBe(false);
    expect(proceed().textContent).toBe('Continue');
    for (const word of ['18', 'adult', 'older', 'younger']) {
      expect(root.textContent.toLowerCase().replace(String(born), ''), word).not.toContain(word);
    }
    fireEvent.click(proceed());
    expect(onSubmit.mock.calls).toEqual([[{ year: born, month: 3 }]]);

    // The answer lives in the stage and goes with it: drawn again, both are empty.
    draw(vm);
    expect(within(button('onboarding.age-month')).getByText('Pick a month')).toBeTruthy();
    expect(within(button('onboarding.age-year')).getByText('Pick a year')).toBeTruthy();
    expect(isDisabled(proceed())).toBe(true);
    expect(document.body.textContent).not.toContain('March');
  });

  it('state picker', () => {
    setViewport(1440, 900);
    const onSubmit = vi.fn<(code: string) => void>();
    draw({ ...fixtures.signInState, statePicker: { codes: STATE_CODES, onSubmit } });
    expect(title()).toBe('Which state or territory do you live in?');
    const proceed = (): HTMLElement => button('auth.state-continue');
    expect(isDisabled(proceed())).toBe(true);
    expect(proceed().textContent).toBe('Pick a state or territory');
    const select = button('auth.state-select');
    expect(within(select).getByText('Pick one')).toBeTruthy();

    fireEvent.click(select);
    const names = within(screen.getByRole('listbox', { name: 'State or territory' }))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(names).toHaveLength(56);
    expect(new Set(names).size).toBe(56);
    // By name, not by code: Alaska's code comes before Alabama's.
    expect(names).toEqual([...names].sort());
    expect(names.slice(0, 4)).toEqual(['Alabama', 'Alaska', 'American Samoa', 'Arizona']);
    expect(names.at(-1)).toBe('Wyoming');
    for (const name of ['District of Columbia', 'Guam', 'Puerto Rico', 'U.S. Virgin Islands']) {
      expect(names, name).toContain(name);
    }

    fireEvent.click(screen.getByTestId('auth.state-select-VT'));
    leave();
    expect(within(button('auth.state-select')).getByText('Vermont')).toBeTruthy();
    expect(isDisabled(proceed())).toBe(false);
    expect(proceed().textContent).toBe('Continue');
    fireEvent.click(proceed());
    expect(onSubmit.mock.calls).toEqual([['VT']]);

    // Only the states the view-model lists are offered.
    draw({ ...fixtures.signInState, statePicker: { codes: ['TX', 'CA'], onSubmit } });
    fireEvent.click(button('auth.state-select'));
    expect(
      within(screen.getByRole('listbox', { name: 'State or territory' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['California', 'Texas']);
  });

  it('agreements', () => {
    const onAgree = vi.fn<() => void>();
    const root = draw({
      ...fixtures.signInAgreements,
      agreements: { ...fixtures.signInAgreements.agreements, onAgree },
    });
    expect(title()).toBe('Before you start');
    expect(root.textContent).toContain(
      'By tapping Agree you accept the Terms and the Content policy, and you have read the Privacy policy.',
    );
    const links = [
      ['auth.agree-terms', 'https://example.test/terms', 'Terms, opens in your browser'],
      [
        'auth.agree-policy',
        'https://example.test/content-policy',
        'Content policy, opens in your browser',
      ],
      [
        'auth.agree-privacy',
        'https://example.test/privacy',
        'Privacy policy, opens in your browser',
      ],
    ] as const;
    for (const [testID, href, name] of links) {
      const link = screen.getByTestId(testID);
      expect(link.getAttribute('href'), testID).toBe(href);
      expect(link.getAttribute('target'), testID).toBe('_blank');
      expect(screen.getByRole('link', { name }), testID).toBe(link);
    }
    expect(screen.getAllByRole('link')).toHaveLength(3);
    // Nothing is ticked for anyone: there is nothing to tick.
    expect(root.querySelectorAll('input, [role="checkbox"], [role="switch"]')).toHaveLength(0);

    const agree = button('onboarding.terms-agree');
    expect(agree.textContent).toBe('Agree');
    expect(isDisabled(agree)).toBe(false);
    expect(onAgree).not.toHaveBeenCalled();
    fireEvent.click(agree);
    expect(onAgree).toHaveBeenCalledTimes(1);
  });

  it('AI sentence and two answers', () => {
    const onAnswer = vi.fn<(allowed: boolean) => void>();
    const root = draw({ ...fixtures.signInAiConsent, aiConsent: { onAnswer } });
    expect(title()).toBe('One more choice');
    expect(within(root).getByText(AI_SENTENCE)).toBeTruthy();
    const allow = button('onboarding.ai-consent-agree');
    const notNow = button('auth.ai-not-now');
    expect(allow.textContent).toBe('Allow');
    expect(notNow.textContent).toBe('Not now');
    // Neither answer is given for the person.
    expect(root.querySelectorAll('input, [role="checkbox"], [role="switch"]')).toHaveLength(0);
    expect(onAnswer).not.toHaveBeenCalled();
    fireEvent.click(allow);
    expect(onAnswer.mock.calls).toEqual([[true]]);
    fireEvent.click(notNow);
    expect(onAnswer.mock.calls).toEqual([[true], [false]]);
  });

  it('signing up shows the step bar', () => {
    const signingUp = Object.entries(FIXTURES).filter(
      ([, vm]) => vm.signingUp && vm.blocked === null,
    );
    expect(signingUp.map(([name]) => name).sort()).toEqual(
      [
        'signInAgeGate',
        'signInAgeGateIncomplete',
        'signInAgreements',
        'signInAiConsent',
        'signInCheckingAge',
        'signInFinishing',
        'signInState',
      ].sort(),
    );
    for (const [name, vm] of signingUp) {
      draw(vm);
      const bar = screen.getByRole('progressbar', { name: STEP });
      expect(bar.getAttribute('aria-valuenow'), name).toBe('1');
      expect(bar.getAttribute('aria-valuemax'), name).toBe('5');
    }
    // Signing in is no step of anything.
    for (const vm of [fixtures.signInMethods, fixtures.signInEmail, fixtures.signInCode]) {
      draw(vm);
      expect(screen.queryByRole('progressbar', { name: STEP })).toBeNull();
    }
    // A code asked for while an account is being made keeps the bar.
    draw({ ...fixtures.signInCode, signingUp: true });
    expect(screen.getByRole('progressbar', { name: STEP })).toBeTruthy();
  });

  it('waiting stages', () => {
    for (const vm of [fixtures.signInCheckingAge, fixtures.signInFinishing]) {
      const root = draw(vm);
      expect(title()).toBe('Setting up your account');
      const waiting = screen.getByRole('progressbar', { name: 'Loading' });
      expect(waiting.getAttribute('aria-busy')).toBe('true');
      // The app is working: it asks nothing and offers nothing but the way back.
      expect(root.querySelectorAll('input, [role="combobox"]')).toHaveLength(0);
      expect(
        [...root.querySelectorAll('a, button, [role="button"], [role="link"]')].map((element) =>
          element.getAttribute('data-testid'),
        ),
      ).toEqual([BACK]);
    }
    // A stage whose own part has not arrived asks nothing either.
    draw({ ...fixtures.signInAgeGate, ageGate: null });
    expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeTruthy();
    expect(screen.queryByTestId('onboarding.age-continue')).toBeNull();
  });

  it('blocked draws the system screens', () => {
    const onBack = vi.fn<() => void>();
    renderWithProviders(<SignInScreenView vm={{ ...fixtures.signInAdultsOnly, onBack }} />);
    expect(screen.queryByTestId(ROOT)).toBeNull();
    expect(screen.getByTestId('system.adults-only')).toBeTruthy();
    expect(title()).toBe('This app is for adults.');
    // No stage is drawn behind it: no option, no field.
    expect(screen.queryByTestId('auth.email-option')).toBeNull();
    fireEvent.click(button('system.adults-only-close'));
    expect(onBack).toHaveBeenCalledTimes(1);

    cleanup();
    renderWithProviders(<SignInScreenView vm={{ ...fixtures.signInStateUnavailable, onBack }} />);
    expect(screen.queryByTestId(ROOT)).toBeNull();
    expect(screen.getByTestId('system.state-unavailable')).toBeTruthy();
    expect(title()).toMatch(/ is not available in Vermont yet\.$/);
    // Nobody is signed in here, so there is no account to delete.
    expect(screen.queryByTestId('system.state-unavailable-delete')).toBeNull();
    fireEvent.click(button('system.state-unavailable-browse'));
    expect(navigation.navigateTo.mock.calls).toEqual([['/']]);
  });

  it('offline', () => {
    const onSubmit = vi.fn<(email: string) => void>();
    const root = draw({
      ...fixtures.signInOffline,
      email: { ...fixtures.signInOffline.email, onSubmit },
    });
    expect(within(root).getByText('No connection. This may be out of date.')).toBeTruthy();
    const proceed = (): HTMLElement => button('auth.email-continue');
    expect(isDisabled(proceed())).toBe(true);
    expect(proceed().textContent).toBe('Needs a connection');
    // A whole address changes nothing while there is no connection.
    type('auth.email-field', 'a@example.test');
    expect(isDisabled(proceed())).toBe(true);
    expect(proceed().textContent).toBe('Needs a connection');
    fireEvent.click(proceed());
    fireEvent.keyDown(field('auth.email-field'), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();

    // On the first stage the email option says so.
    const onChooseEmail = vi.fn<() => void>();
    draw({ ...fixtures.signInMethods, offline: true, onChooseEmail });
    const email = button('auth.email-option');
    expect(isDisabled(email)).toBe(true);
    expect(email.textContent).toBe('Needs a connection');
    fireEvent.click(email);
    expect(onChooseEmail).not.toHaveBeenCalled();

    // The second answer of a stage with two is withheld with the first.
    const onAnswer = vi.fn<(allowed: boolean) => void>();
    draw({ ...fixtures.signInAiConsent, offline: true, aiConsent: { onAnswer } });
    expect(isDisabled(button('onboarding.ai-consent-agree'))).toBe(true);
    expect(button('onboarding.ai-consent-agree').textContent).toBe('Needs a connection');
    expect(screen.queryByTestId('auth.ai-not-now')).toBeNull();
    fireEvent.click(button('onboarding.ai-consent-agree'));
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('legal links need https', () => {
    const root = draw({
      ...fixtures.signInAgreements,
      agreements: {
        ...fixtures.signInAgreements.agreements,
        links: {
          terms: 'http://api.test/terms',
          contentPolicy: 'https://example.test/content-policy',
          privacyPolicy: 'https://example.test/privacy',
        },
      },
    });
    // The sentence is whole; the document with no https address is words, not a link.
    expect(root.textContent).toContain(
      'By tapping Agree you accept the Terms and the Content policy, and you have read the Privacy policy.',
    );
    expect(screen.queryByTestId('auth.agree-terms')).toBeNull();
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      'https://example.test/content-policy',
      'https://example.test/privacy',
    ]);
    expect(root.innerHTML).not.toContain('http://api.test');

    draw(fixtures.signInAgreements);
    expect(screen.getByTestId('auth.agree-terms').getAttribute('href')).toBe(
      'https://example.test/terms',
    );

    // The line under the sign-in options follows the same rule.
    const methods = draw({
      ...fixtures.signInMethodsEmailOnly,
      legalLinks: { terms: 'http://api.test/terms', privacyPolicy: '/privacy' },
    });
    expect(methods.textContent).toContain('Terms · Privacy policy');
    expect(screen.queryByTestId('auth.methods-terms')).toBeNull();
    expect(screen.queryByTestId('auth.methods-privacy')).toBeNull();
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(methods.innerHTML).not.toContain('http://api.test');

    draw({
      ...fixtures.signInMethodsEmailOnly,
      legalLinks: { terms: 'https://example.test/terms', privacyPolicy: '/privacy' },
    });
    expect(screen.getByTestId('auth.methods-terms').getAttribute('href')).toBe(
      'https://example.test/terms',
    );
    expect(screen.queryByTestId('auth.methods-privacy')).toBeNull();
  });

  it('tight keeps every stage whole', () => {
    setViewport(360, 740);
    const wide = draw(fixtures.signInAgeGate);
    const wideSize = within(wide).getByRole('heading', { level: 1 }).style.fontSize;
    const tight = draw(fixtures.signInAgeGate, { textScale: 1.3 });
    const heading = within(tight).getByRole('heading', { level: 1 });
    // The heading takes the smaller of its two roles, and nothing is left out.
    expect(heading.textContent).toBe('When were you born?');
    expect(Number.parseFloat(heading.style.fontSize) / 1.3).toBeLessThan(
      Number.parseFloat(wideSize),
    );
    expect(button('onboarding.age-month')).toBeTruthy();
    expect(button('onboarding.age-continue')).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: STEP })).toBeTruthy();
  });
});
