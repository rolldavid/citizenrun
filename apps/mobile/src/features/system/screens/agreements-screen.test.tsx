import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import * as fixtures from '@/features/system/view-models/agreements.fixtures';
import type { AgreementsViewModel } from '@/features/system/view-models/agreements.types';
import { renderWithProviders, setViewport } from '@/test/render';
import type { RenderWithProvidersOptions } from '@/test/render';

import { AgreementsScreenView } from './agreements-screen';

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

const FIXTURES: Readonly<Record<string, AgreementsViewModel>> = fixtures;
const SHEET = 'system.agreements';
const COMPACT = [390, 844] as const;
const EXPANDED = [1440, 900] as const;
const LEAVE = 'If you do not agree, you can delete your account.';
/** How a link that leaves the app names itself. */
const OUTSIDE = ', opens in your browser';

/** Renders the sheet from one view-model, in place of whatever was drawn before. */
function draw(vm: AgreementsViewModel, options: RenderWithProvidersOptions = {}): HTMLElement {
  cleanup();
  renderWithProviders(<AgreementsScreenView vm={vm} />, options);
  return screen.getByTestId(SHEET);
}

/** A press and release of Escape, as a key press sends them to the page. */
function pressEscape(): void {
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.keyUp(document, { key: 'Escape' });
}

/** The scrim: the layer after the sheet's frame. */
function scrimOf(frame: HTMLElement): HTMLElement {
  const scrim = frame.nextElementSibling;
  if (!(scrim instanceof HTMLElement)) {
    throw new Error('the sheet has no scrim');
  }
  return scrim;
}

function hrefOf(testID: string): string | null {
  return screen.getByTestId(testID).getAttribute('href');
}

describe('AgreementsScreenView', () => {
  it('renders every fixture', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual([
      'agreementsError',
      'agreementsPrivacyOnly',
      'agreementsSaving',
      'agreementsTerms',
    ]);
    for (const [width, height] of [[360, 740], [430, 932], [820, 1180], EXPANDED] as const) {
      setViewport(width, height);
      for (const [name, vm] of Object.entries(FIXTURES)) {
        for (const theme of ['light', 'dark'] as const) {
          const sheet = draw(vm, { theme });
          expect(sheet.textContent, name).not.toContain('{{');
          expect(sheet.textContent, name).not.toContain('<');
          expect(sheet.getAttribute('role'), name).toBe('dialog');
          expect(sheet.getAttribute('aria-modal'), name).toBe('true');
        }
      }
    }
    setViewport(...COMPACT);
  });

  it('terms changed', () => {
    for (const viewport of [COMPACT, EXPANDED]) {
      setViewport(viewport[0], viewport[1]);
      const onAgree = vi.fn<() => void>();
      const sheet = draw({ ...fixtures.agreementsTerms, onAgree });

      const headings = within(sheet).getAllByRole('heading');
      expect(headings.map((heading) => heading.textContent)).toEqual(['We updated our terms.']);
      expect(screen.getByRole('dialog', { name: 'We updated our terms.' })).toBe(sheet);
      expect(sheet.textContent).toContain(
        'Read the Terms, the Content policy and the Privacy policy. Tap Agree to keep using ',
      );
      expect(sheet.textContent).toContain(LEAVE);

      // Each changed document is a link to its public page, in the sentence's own order.
      expect(hrefOf('system.agreements-terms')).toBe(fixtures.agreementsTerms.links.terms);
      expect(hrefOf('system.agreements-policy')).toBe(fixtures.agreementsTerms.links.contentPolicy);
      expect(hrefOf('system.agreements-privacy')).toBe(
        fixtures.agreementsTerms.links.privacyPolicy,
      );
      expect(screen.getByRole('link', { name: `Terms${OUTSIDE}` })).toBe(
        screen.getByTestId('system.agreements-terms'),
      );
      expect(screen.getByRole('link', { name: `Content policy${OUTSIDE}` })).toBe(
        screen.getByTestId('system.agreements-policy'),
      );
      expect(screen.getByRole('link', { name: `Privacy policy${OUTSIDE}` })).toBe(
        screen.getByTestId('system.agreements-privacy'),
      );
      expect(screen.getByTestId('system.agreements-terms').getAttribute('target')).toBe('_blank');

      // The way out stays inside the app.
      const leave = screen.getByRole('link', { name: 'delete your account' });
      expect(leave).toBe(screen.getByTestId('system.agreements-delete'));
      expect(leave.getAttribute('href')).toBe(fixtures.agreementsTerms.deleteHref);
      expect(leave.getAttribute('target')).toBeNull();
      expect(within(sheet).getAllByRole('link')).toHaveLength(4);

      // The first thing in the sheet that takes focus is its words, so no link is entered by chance.
      const first = sheet.querySelector('[tabindex]');
      expect(first?.getAttribute('tabindex')).toBe('-1');
      expect(first?.getAttribute('role')).toBeNull();
      expect(first?.textContent).toContain(LEAVE);
      expect(first?.contains(screen.getByTestId('system.agreements-agree'))).toBe(false);

      // One tap, and nothing ticked for the person: the sheet holds no box to tick.
      expect(sheet.querySelectorAll('input, [role="checkbox"], [role="switch"]')).toHaveLength(0);
      const agree = screen.getByTestId('system.agreements-agree');
      expect(within(sheet).getAllByRole('button')).toEqual([agree]);
      expect(screen.getByRole('button', { name: 'Agree' })).toBe(agree);
      expect(agree.getAttribute('aria-busy')).not.toBe('true');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(onAgree).not.toHaveBeenCalled();
      fireEvent.click(agree);
      expect(onAgree).toHaveBeenCalledTimes(1);
    }
    setViewport(...COMPACT);
  });

  it('privacy only', () => {
    const onAgree = vi.fn<() => void>();
    const sheet = draw({ ...fixtures.agreementsPrivacyOnly, onAgree });
    expect(
      within(sheet)
        .getAllByRole('heading')
        .map((heading) => heading.textContent),
    ).toEqual(['We updated the privacy policy.']);
    expect(sheet.textContent).toContain('Read the Privacy policy. Tap OK to keep using ');
    expect(sheet.textContent).not.toContain('Content policy');
    expect(sheet.textContent).toContain(LEAVE);

    expect(hrefOf('system.agreements-privacy')).toBe(
      fixtures.agreementsPrivacyOnly.links.privacyPolicy,
    );
    expect(screen.queryByTestId('system.agreements-terms')).toBeNull();
    expect(screen.queryByTestId('system.agreements-policy')).toBeNull();
    // The one document, and the way out.
    expect(
      within(sheet)
        .getAllByRole('link')
        .map((link) => link.getAttribute('data-testid')),
    ).toEqual(['system.agreements-privacy', 'system.agreements-delete']);

    const ok = screen.getByTestId('system.agreements-agree');
    expect(ok.textContent).toBe('OK');
    expect(screen.queryByRole('button', { name: 'Agree' })).toBeNull();
    fireEvent.click(ok);
    expect(onAgree).toHaveBeenCalledTimes(1);
  });

  it('a terms change with the privacy policy is agreed to, not told', () => {
    const sheet = draw({
      ...fixtures.agreementsTerms,
      needed: ['privacy_policy', 'content_policy'],
    });
    expect(sheet.textContent).toContain('We updated our terms.');
    expect(screen.getByTestId('system.agreements-agree').textContent).toBe('Agree');
    expect(screen.getByTestId('system.agreements-terms')).toBeTruthy();
  });

  it('saving and error', () => {
    const onAgree = vi.fn<() => void>();
    draw({ ...fixtures.agreementsSaving, onAgree });
    const waiting = screen.getByTestId('system.agreements-agree');
    expect(waiting.getAttribute('aria-busy')).toBe('true');
    // A second tap while the first is on its way sends nothing more.
    fireEvent.click(waiting);
    expect(onAgree).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();

    const sheet = draw({ ...fixtures.agreementsError, onAgree });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe("This isn't available right now. Try again in a few minutes.");
    expect(sheet.contains(alert)).toBe(true);
    // The refusal stands over the button, which can be pressed again.
    const agree = screen.getByTestId('system.agreements-agree');
    expect(alert.compareDocumentPosition(agree) & Node.DOCUMENT_POSITION_FOLLOWING).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByTestId('system.agreements-delete').compareDocumentPosition(alert) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeGreaterThan(0);
    expect(agree.getAttribute('aria-busy')).not.toBe('true');
    fireEvent.click(agree);
    expect(onAgree).toHaveBeenCalledTimes(1);

    // Each refusal reads its own sentence, and one without a code the generic one.
    draw({ ...fixtures.agreementsError, errorCode: 'rate_limited' });
    expect(screen.getByRole('alert').textContent).not.toBe(alert.textContent);
    draw({ ...fixtures.agreementsError, errorCode: null });
    expect(screen.getByRole('alert').textContent).toBe('Something went wrong. Try again.');
  });

  it('cannot be dismissed', () => {
    for (const viewport of [COMPACT, EXPANDED]) {
      setViewport(viewport[0], viewport[1]);
      const onAgree = vi.fn<() => void>();
      const sheet = draw({ ...fixtures.agreementsTerms, onAgree });
      // No grabber to press, no scrim to press, no close control of any kind.
      expect(screen.queryByTestId(`${SHEET}-grabber`)).toBeNull();
      expect(screen.queryByTestId(`${SHEET}-scrim`)).toBeNull();
      expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
      const scrim = scrimOf(sheet);
      expect(scrim.querySelector('[role="button"], button, a')).toBeNull();
      fireEvent.click(scrim);
      pressEscape();
      expect(screen.getByTestId(SHEET)).toBe(sheet);
      expect(sheet.isConnected).toBe(true);
      expect(screen.getByTestId('system.agreements-agree')).toBeTruthy();
      // Neither is an answer.
      expect(onAgree).not.toHaveBeenCalled();
    }
    setViewport(...COMPACT);
  });

  it('a document with no https address is words, not a link', () => {
    const sheet = draw({
      ...fixtures.agreementsTerms,
      links: {
        terms: 'http://api.test/terms',
        contentPolicy: '/content-policy',
        privacyPolicy: 'https://example.test/privacy',
      },
    });
    expect(screen.queryByTestId('system.agreements-terms')).toBeNull();
    expect(screen.queryByTestId('system.agreements-policy')).toBeNull();
    expect(hrefOf('system.agreements-privacy')).toBe('https://example.test/privacy');
    // The sentence reads the same, and the way out is still a link.
    expect(sheet.textContent).toContain(
      'Read the Terms, the Content policy and the Privacy policy. Tap Agree to keep using ',
    );
    expect(
      within(sheet)
        .getAllByRole('link')
        .map((link) => link.getAttribute('data-testid')),
    ).toEqual(['system.agreements-privacy', 'system.agreements-delete']);
  });
});
