import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signInCode, signInEmail } from '@/features/auth/view-models/sign-in.fixtures';
import { renderWithProviders, setViewport } from '@/test/render';
import { motion } from '@/ui/motion';

import { AddEmailSheet } from './add-email-sheet';
import type { AddEmailSheetProps } from './add-email-sheet';

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

const SHEET = 'auth.add-email-sheet';
const TITLE = 'Add an email';
const COMPACT = [390, 844] as const;
const EXPANDED = [1440, 900] as const;
/** The time the fixtures are written at: a code fixture may be sent again 30 seconds later. */
const FIXTURE_TIME = Date.parse('2027-01-15T12:00:00.000Z');

const EMAIL = signInEmail.email;
const CODE = signInCode.code;

const CLOSED: AddEmailSheetProps = {
  title: TITLE,
  stage: 'closed',
  email: EMAIL,
  code: null,
  onClose: () => undefined,
};
const AT_EMAIL: AddEmailSheetProps = { ...CLOSED, stage: 'email' };
const AT_CODE: AddEmailSheetProps = { ...CLOSED, stage: 'code', code: CODE };

/** Draws the sheet again from new props in the same place, as its caller does. */
let redraw: (props: AddEmailSheetProps) => void = () => undefined;

/** Renders the sheet, in place of whatever was drawn before. */
function draw(props: AddEmailSheetProps): void {
  cleanup();
  const view = renderWithProviders(<AddEmailSheet {...props} />);
  redraw = (next) => {
    view.rerender(<AddEmailSheet {...next} />);
  };
}

function sheet(): HTMLElement {
  return screen.getByTestId(SHEET);
}

function input(testID: string): HTMLInputElement {
  const element = screen.getByTestId(testID);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`${testID} is not an input`);
  }
  return element;
}

function type(testID: string, value: string): void {
  fireEvent.change(input(testID), { target: { value } });
}

function isDisabled(element: HTMLElement): boolean {
  return element.getAttribute('aria-disabled') === 'true';
}

function isBusy(element: HTMLElement): boolean {
  return element.getAttribute('aria-busy') === 'true';
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

describe('AddEmailSheet', () => {
  it('stages', () => {
    // Closed: nothing is drawn.
    draw(CLOSED);
    expect(screen.queryByTestId(SHEET)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    // The address: the field and one button, which says what is missing until an address is typed.
    const onSubmitEmail = vi.fn<(email: string) => void>();
    draw({ ...AT_EMAIL, email: { ...EMAIL, onSubmit: onSubmitEmail } });
    expect(screen.getByRole('dialog', { name: TITLE })).toBe(sheet());
    expect(screen.getByLabelText('Email')).toBe(input('auth.email-field'));
    expect(within(sheet()).queryByTestId('auth.code-field')).toBeNull();
    const next = within(sheet()).getByTestId('auth.email-continue');
    expect(isDisabled(next)).toBe(true);
    expect(next.textContent).toBe('Enter your email');
    fireEvent.click(next);
    type('auth.email-field', 'not an address');
    expect(isDisabled(next)).toBe(true);
    type('auth.email-field', '  fixture@example.test ');
    expect(isDisabled(next)).toBe(false);
    expect(next.textContent).toBe('Continue');
    fireEvent.click(next);
    expect(onSubmitEmail).toHaveBeenCalledTimes(1);
    expect(onSubmitEmail).toHaveBeenLastCalledWith('fixture@example.test');

    // While the code is being sent the button waits.
    redraw({ ...AT_EMAIL, email: { ...EMAIL, status: 'sending', onSubmit: onSubmitEmail } });
    expect(isBusy(within(sheet()).getByTestId('auth.email-continue'))).toBe(true);

    // The code: the six boxes in place of the address, and the button that sends them.
    const onSubmitCode = vi.fn<(code: string) => void>();
    redraw({ ...AT_CODE, code: { ...CODE, onSubmit: onSubmitCode } });
    expect(within(sheet()).queryByTestId('auth.email-field')).toBeNull();
    expect(sheet().textContent).toContain('fixture@example.test');
    const verify = within(sheet()).getByTestId('auth.code-verify');
    expect(isDisabled(verify)).toBe(true);
    expect(verify.textContent).toBe('Enter the 6 digits');
    type('auth.code-field', '123456');
    expect(onSubmitCode).toHaveBeenLastCalledWith('123456');
    expect(verify.textContent).toBe('Verify');
    fireEvent.click(verify);
    expect(onSubmitCode).toHaveBeenCalledTimes(2);

    // A code that turned out wrong is typed again from the first box.
    redraw({ ...AT_CODE, code: { ...CODE, onSubmit: onSubmitCode, status: 'checking' } });
    expect(isBusy(within(sheet()).getByTestId('auth.code-verify'))).toBe(true);
    redraw({ ...AT_CODE, code: { ...CODE, onSubmit: onSubmitCode, status: 'wrong' } });
    expect(input('auth.code-field').value).toBe('');
    expect(sheet().textContent).toContain('That code is not right. Try again.');
  });

  it('an address that belongs to another account is said on the field', () => {
    draw({ ...AT_EMAIL, email: { ...EMAIL, errorCode: 'email_in_use' } });
    const sentence = 'That email belongs to another account.';
    expect(within(sheet()).getByRole('alert').textContent).toBe(sentence);
    // On the field: the address is still asked for, and nothing else says it.
    expect(within(sheet()).getAllByText(sentence)).toHaveLength(1);
    expect(input('auth.email-field')).toBeTruthy();
    const described = (input('auth.email-field').getAttribute('aria-describedby') ?? '').split(' ');
    const lines = described.map((id) => document.getElementById(id)?.textContent ?? '');
    expect(lines).toContain(sentence);
  });

  it('closes, and keeps nothing that was typed', () => {
    const onClose = vi.fn<() => void>();
    draw({ ...AT_EMAIL, onClose });
    type('auth.email-field', 'fixture@example.test');
    fireEvent.click(screen.getByTestId(`${SHEET}-grabber`));
    expect(onClose).toHaveBeenCalledTimes(1);

    redraw({ ...CLOSED, onClose });
    leave();
    expect(screen.queryByTestId(SHEET)).toBeNull();
    redraw({ ...AT_EMAIL, onClose });
    expect(input('auth.email-field').value).toBe('');

    // The digits go with their code.
    redraw({ ...AT_CODE, onClose });
    type('auth.code-field', '123');
    redraw({ ...CLOSED, onClose });
    leave();
    redraw({ ...AT_CODE, onClose });
    expect(input('auth.code-field').value).toBe('');
  });

  it('is a dialog in a window', () => {
    const onClose = vi.fn<() => void>();
    setViewport(...EXPANDED);
    draw({ ...AT_CODE, onClose });
    expect(screen.getByRole('dialog', { name: TITLE })).toBe(sheet());
    expect(screen.queryByTestId(`${SHEET}-grabber`)).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyUp(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
