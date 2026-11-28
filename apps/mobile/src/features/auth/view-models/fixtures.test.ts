import { STATE_CODES } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';

import { FIXTURE_APPLE_BUTTON, FIXTURE_GOOGLE_BUTTON } from './__fixtures__/provider-buttons';
import * as reauthFixtures from './reauth.fixtures';
import * as signInFixtures from './sign-in.fixtures';
import * as welcomeFixtures from './welcome.fixtures';

describe('the auth fixtures', () => {
  it('sign-in fixtures are the states of the screen', () => {
    expect(Object.keys(signInFixtures).sort()).toEqual(
      [
        'signInMethods',
        'signInMethodsEmailOnly',
        'signInMethodsBusy',
        'signInMethodsNotice',
        'signInEmail',
        'signInEmailSending',
        'signInEmailError',
        'signInCode',
        'signInCodeChecking',
        'signInCodeWrong',
        'signInCodeLocked',
        'signInCodeExpired',
        'signInCodeResendLimited',
        'signInCheckingAge',
        'signInFinishing',
        'signInState',
        'signInAgreements',
        'signInAdultsOnly',
        'signInStateUnavailable',
        'signInOffline',
      ].sort(),
    );
    const f = signInFixtures;
    expect(f.signInMethods.appleButton).toBe(FIXTURE_APPLE_BUTTON);
    expect(f.signInMethods.googleButton).toBe(FIXTURE_GOOGLE_BUTTON);
    expect(f.signInMethodsEmailOnly).toMatchObject({ appleButton: null, googleButton: null });
    expect(f.signInMethodsBusy.providersBusy).toBe(true);
    expect(f.signInMethodsNotice.notice).toEqual({
      code: 'account_deleting',
      retryAfterSeconds: null,
    });
    expect(f.signInEmailSending.email.status).toBe('sending');
    expect(f.signInEmailError.email.errorCode).toBe('email_undeliverable');
    expect(f.signInCode.code).toMatchObject({
      sentTo: 'fixture@example.test',
      resendAvailableAt: '2027-01-15T12:00:30.000Z',
      status: 'idle',
    });
    expect(f.signInCodeChecking.code.status).toBe('checking');
    expect(f.signInCodeWrong.code.status).toBe('wrong');
    expect(f.signInCodeLocked.code.status).toBe('locked');
    expect(f.signInCodeExpired.code.status).toBe('expired');
    expect(f.signInCodeResendLimited.code).toMatchObject({
      resendStatus: 'limited',
      resendRetryAfterSeconds: 900,
    });
    expect(f.signInState.statePicker.codes).toBe(STATE_CODES);
    expect(f.signInAdultsOnly.blocked).toBe('adultsOnly');
    expect(f.signInStateUnavailable.blocked).toEqual({ stateUnavailable: 'VT' });
    expect(f.signInOffline).toMatchObject({ stage: 'email', offline: true });
    for (const fixture of Object.values(signInFixtures)) {
      expect(fixture.signingUp).toBe(
        ['checkingAge', 'state', 'agreements', 'finishing'].includes(fixture.stage),
      );
      expect(fixture.code !== null).toBe(fixture.stage === 'code');
    }
    for (const link of Object.values(f.signInAgreements.agreements.links)) {
      expect(link.startsWith('https://example.test/')).toBe(true);
    }
    // Every stage carries the two documents the methods stage names, so every capture shows them.
    for (const fixture of Object.values(signInFixtures)) {
      expect(fixture.legalLinks).toEqual({
        terms: 'https://example.test/terms',
        privacyPolicy: 'https://example.test/privacy',
      });
    }
  });

  it('welcome fixture', () => {
    expect(Object.keys(welcomeFixtures)).toEqual(['welcomeDefault']);
    expect(welcomeFixtures.welcomeDefault).toEqual({
      startHref: '/sign-in',
      links: { terms: 'https://example.test/terms', privacyPolicy: 'https://example.test/privacy' },
    });
  });

  it('re-authentication fixtures are its five states', () => {
    expect(Object.keys(reauthFixtures).sort()).toEqual(
      ['reauthMethods', 'reauthCode', 'reauthCodeWrong', 'reauthMismatch', 'reauthBusy'].sort(),
    );
    expect(reauthFixtures.reauthMethods).toMatchObject({
      open: true,
      methods: ['email', 'apple'],
      appleButton: FIXTURE_APPLE_BUTTON,
      googleButton: null,
      code: null,
    });
    expect(reauthFixtures.reauthCode.code.status).toBe('idle');
    expect(reauthFixtures.reauthCodeWrong.code.status).toBe('wrong');
    expect(reauthFixtures.reauthMismatch.notice).toEqual({
      code: 'reauth_mismatch',
      retryAfterSeconds: null,
    });
    expect(reauthFixtures.reauthBusy.providersBusy).toBe(true);
  });
});
