import { describe, expect, it, vi } from 'vitest';

import type { GuardResult } from '@/lib/navigation';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';

import { agreementsNeeded, buildShell, guardSessionOf, systemScreenFor } from './root.build';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

const STAY: GuardResult = { kind: 'stay' };

function changedTerms() {
  const me = fixtureMe();
  return fixtureMe({ consents: { ...me.consents, needed: ['terms'] } });
}

describe('guardSessionOf', () => {
  it('reads the session for the guard', () => {
    const me = fixtureMe({ onboardingStep: 'handle', role: 'admin' });
    expect(guardSessionOf('present', me)).toEqual({
      kind: 'ready',
      onboardingStep: 'handle',
      role: 'admin',
    });
    // A loaded Me wins over a presence not yet known.
    expect(guardSessionOf('unknown', me).kind).toBe('ready');
    expect(guardSessionOf('absent', null)).toEqual({ kind: 'none' });
    // A session that ended is gone even while its last Me is still cached.
    expect(guardSessionOf('absent', me)).toEqual({ kind: 'none' });
    expect(guardSessionOf('unknown', null)).toEqual({ kind: 'pending' });
    expect(guardSessionOf('present', null)).toEqual({ kind: 'pending' });
  });
});

describe('systemScreenFor', () => {
  const base = { upgradeBlocked: false, guard: STAY, minorEnded: false, me: null, path: '/' };

  it('shows the system screens in their order', () => {
    const needsTerms = changedTerms();
    expect(systemScreenFor(base)).toBeNull();
    expect(systemScreenFor({ ...base, me: fixtureMe() })).toBeNull();
    expect(systemScreenFor({ ...base, me: needsTerms })).toBe('agreements');
    expect(systemScreenFor({ ...base, me: needsTerms, minorEnded: true })).toBe('adultsOnly');
    expect(
      systemScreenFor({ ...base, me: needsTerms, minorEnded: true, upgradeBlocked: true }),
    ).toBe('update');
    expect(
      systemScreenFor({ ...base, minorEnded: true, guard: { kind: 'system', screen: 'update' } }),
    ).toBe('update');
    expect(systemScreenFor({ ...base, guard: { kind: 'redirect', to: '/welcome' } })).toBeNull();
  });
});

describe('agreementsNeeded', () => {
  it('shows the agreements only after onboarding and never on export or deletion', () => {
    const me = changedTerms();
    expect(agreementsNeeded(me, '/')).toBe(true);
    expect(agreementsNeeded(me, '/settings')).toBe(true);
    expect(agreementsNeeded({ ...me, onboardingStep: 'issues' }, '/')).toBe(false);
    expect(agreementsNeeded(me, '/settings/export')).toBe(false);
    expect(agreementsNeeded(me, '/settings/delete-account')).toBe(false);
    expect(agreementsNeeded(fixtureMe(), '/')).toBe(false);
    expect(agreementsNeeded(null, '/')).toBe(false);
  });
});

describe('buildShell', () => {
  const signedIn = guardSessionOf('present', fixtureMe());

  it('builds the shell with its empty members', () => {
    expect(buildShell({ path: '/', system: null, session: signedIn })).toEqual({
      mode: 'app',
      active: 'home',
      unread: { messages: 0, activity: 0 },
      place: null,
      signedIn: true,
      showGetAppBar: false,
      suspended: null,
    });
    expect(buildShell({ path: '/', system: 'adultsOnly', session: signedIn }).mode).toBe('bare');
    expect(buildShell({ path: '/', system: 'update', session: signedIn }).mode).toBe('bare');
    // The agreements sheet stands over the navigator, so the shell stays.
    expect(buildShell({ path: '/', system: 'agreements', session: signedIn })).toMatchObject({
      mode: 'app',
      active: 'home',
    });
    expect(buildShell({ path: '/settings', system: null, session: signedIn }).active).toBe(
      'profile',
    );
    expect(buildShell({ path: '/', system: null, session: { kind: 'pending' } }).signedIn).toBe(
      false,
    );
    expect(buildShell({ path: '/', system: null, session: { kind: 'none' } }).signedIn).toBe(false);
  });

  it('a system screen that replaces the navigator makes every path bare with no active item', () => {
    for (const path of ['/', '/settings', '/welcome']) {
      for (const system of ['update', 'adultsOnly'] as const) {
        const shell = buildShell({ path, system, session: signedIn });
        expect(shell.mode).toBe('bare');
        expect(shell.active).toBeNull();
      }
    }
    expect(buildShell({ path: '/welcome', system: null, session: { kind: 'none' } }).mode).toBe(
      'bare',
    );
  });
});
