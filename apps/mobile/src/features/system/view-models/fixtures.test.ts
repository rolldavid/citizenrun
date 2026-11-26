import { describe, expect, it } from 'vitest';

import * as rootFixtures from './root.fixtures';

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
});
