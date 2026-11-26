import { describe, expect, it } from 'vitest';

import * as adultsOnlyFixtures from './adults-only.fixtures';
import * as agreementsFixtures from './agreements.fixtures';
import * as rootFixtures from './root.fixtures';
import * as stateUnavailableFixtures from './state-unavailable.fixtures';

describe('the system fixtures', () => {
  it('root fixtures are the six states', () => {
    expect(Object.keys(rootFixtures).sort()).toEqual(
      [
        'rootStarting',
        'rootSignedOut',
        'rootSignedIn',
        'rootUpdate',
        'rootAdultsOnly',
        'rootAgreements',
      ].sort(),
    );
    expect(rootFixtures.rootSignedIn.shell).toMatchObject({
      signedIn: true,
      mode: 'app',
      active: 'home',
    });
    expect(rootFixtures.rootAgreements.shell.mode).toBe('app');
    for (const fixture of [rootFixtures.rootAdultsOnly, rootFixtures.rootUpdate]) {
      expect(fixture.shell.mode).toBe('bare');
      expect(fixture.shell.active).toBeNull();
    }
  });
  it('adults-only fixture', () => {
    expect(Object.keys(adultsOnlyFixtures)).toEqual(['adultsOnly']);
  });

  it('agreements fixtures are the four states', () => {
    expect(Object.keys(agreementsFixtures).sort()).toEqual(
      ['agreementsTerms', 'agreementsPrivacyOnly', 'agreementsSaving', 'agreementsError'].sort(),
    );
    expect(agreementsFixtures.agreementsTerms.needed).toEqual(['terms', 'content_policy']);
    expect(agreementsFixtures.agreementsPrivacyOnly.needed).toEqual(['privacy_policy']);
    expect(agreementsFixtures.agreementsSaving.status).toBe('saving');
    expect(agreementsFixtures.agreementsError).toMatchObject({
      status: 'error',
      errorCode: 'unavailable',
    });
    for (const fixture of Object.values(agreementsFixtures)) {
      for (const link of Object.values(fixture.links)) {
        expect(link.startsWith('https://example.test/')).toBe(true);
      }
    }
  });

  it('state-unavailable fixtures are the two states', () => {
    expect(Object.keys(stateUnavailableFixtures).sort()).toEqual(
      ['stateUnavailableNamed', 'stateUnavailableGeneric'].sort(),
    );
    expect(stateUnavailableFixtures.stateUnavailableNamed).toMatchObject({
      stateCode: 'VT',
      signedIn: false,
      deleteHref: null,
    });
    expect(stateUnavailableFixtures.stateUnavailableGeneric).toMatchObject({
      stateCode: null,
      signedIn: true,
      deleteHref: '/settings/delete-account',
    });
  });
});
