import { describe, expect, it } from 'vitest';
import type { AuthLevel, RouteMeta } from '@citizenrun/shared';
import { evaluateGates, isAdmin, parseAdminEmails } from './gates.ts';
import type { Viewer } from './session.ts';

const NOW = new Date('2027-03-05T12:00:00.000Z');
const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const ADMIN_EMAILS = parseAdminEmails(['admin@example.test']);

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function viewer(overrides: Partial<Viewer> = {}): Viewer {
  return {
    userId: '0195d2c4-0000-7000-8000-000000000001',
    sessionId: '0195d2c4-0000-7000-8000-000000000002',
    platform: 'ios',
    role: 'user',
    email: 'test_1@example.test',
    status: 'active',
    onboardingStep: 'done',
    createdAt: ago(30 * 24 * HOUR_MS),
    authenticatedAt: ago(MINUTE_MS),
    ...overrides,
  };
}

function admin(overrides: Partial<Viewer> = {}): Viewer {
  return viewer({ role: 'admin', email: 'admin@example.test', ...overrides });
}

function meta(auth: AuthLevel, extra: Partial<RouteMeta> = {}): RouteMeta {
  return { auth, rateLimit: 'fixture_policy', ...extra };
}

function gate(
  routeMeta: RouteMeta,
  who: Viewer | null,
  method = 'POST',
): ReturnType<typeof evaluateGates> {
  return evaluateGates({
    meta: routeMeta,
    method,
    viewer: who,
    now: NOW,
    adminEmails: ADMIN_EMAILS,
  });
}

describe('gates', () => {
  it('gate 1: a none route applies no gate', () => {
    expect(gate(meta('none'), viewer({ status: 'suspended' }))).toBeNull();
    expect(gate(meta('none'), null)).toBeNull();
  });

  it('gate 2: an optional route allows no viewer', () => {
    expect(gate(meta('optional'), null)).toBeNull();
    expect(gate(meta('optional'), viewer())).toBeNull();
  });

  it('gate 3: user, onboarded and admin need a viewer', () => {
    expect(gate(meta('user'), null)).toBe('unauthenticated');
    expect(gate(meta('onboarded'), null)).toBe('unauthenticated');
    // No viewer is unauthenticated before any admin condition is read.
    expect(gate(meta('admin'), null)).toBe('unauthenticated');
    expect(gate(meta('user'), viewer())).toBeNull();
  });

  it('gate 4: admin', () => {
    const route = meta('admin');
    expect(gate(route, admin())).toBeNull();
    expect(gate(route, admin({ role: 'user' }))).toBe('forbidden');
    expect(gate(route, admin({ email: 'other@example.test' }))).toBe('forbidden');
    expect(gate(route, admin({ email: null }))).toBe('forbidden');
    // The viewer's email is compared lower-cased.
    expect(gate(route, admin({ email: 'Admin@Example.test' }))).toBeNull();
    // CTL-16: a suspended admin is refused.
    expect(gate(route, admin({ status: 'suspended' }), 'GET')).toBe('forbidden');
    expect(gate(route, admin({ authenticatedAt: ago(11 * HOUR_MS + 59 * MINUTE_MS) }))).toBeNull();
    // CTL-16: a sign-in 13 hours old gets recent_sign_in_required; the edge is 12 hours.
    expect(gate(route, admin({ authenticatedAt: ago(12 * HOUR_MS + SECOND_MS) }))).toBe(
      'recent_sign_in_required',
    );
    expect(gate(route, admin({ authenticatedAt: ago(12 * HOUR_MS) }))).toBe(
      'recent_sign_in_required',
    );
    expect(gate(route, admin({ authenticatedAt: ago(13 * HOUR_MS) }))).toBe(
      'recent_sign_in_required',
    );
    // A role, list or status failure is forbidden even when the sign-in is also old.
    expect(gate(route, admin({ role: 'user', authenticatedAt: ago(13 * HOUR_MS) }))).toBe(
      'forbidden',
    );
    // CTL-16: an admin whose email left ADMIN_EMAILS is refused on the next request.
    expect(
      evaluateGates({
        meta: route,
        method: 'GET',
        viewer: admin(),
        now: NOW,
        adminEmails: parseAdminEmails(['someone-else@example.test']),
      }),
    ).toBe('forbidden');
    expect(
      evaluateGates({
        meta: route,
        method: 'GET',
        viewer: admin(),
        now: NOW,
        adminEmails: parseAdminEmails(null),
      }),
    ).toBe('forbidden');
  });

  it('gate 5: recent sign-in', () => {
    const route = meta('user', { recentSignIn: '15m' });
    expect(
      gate(route, viewer({ authenticatedAt: ago(14 * MINUTE_MS + 59 * SECOND_MS) })),
    ).toBeNull();
    expect(gate(route, viewer({ authenticatedAt: ago(15 * MINUTE_MS + SECOND_MS) }))).toBe(
      'recent_sign_in_required',
    );
    // A route without the flag does not read the sign-in time.
    expect(gate(meta('user'), viewer({ authenticatedAt: ago(30 * 24 * HOUR_MS) }))).toBeNull();
  });

  it('gate 6: suspension blocks writes', () => {
    const suspended = viewer({ status: 'suspended' });
    expect(gate(meta('user'), suspended, 'GET')).toBeNull();
    expect(gate(meta('user'), suspended, 'HEAD')).toBeNull();
    expect(gate(meta('user'), suspended, 'POST')).toBe('account_suspended');
    expect(gate(meta('user'), suspended, 'DELETE')).toBe('account_suspended');
    expect(gate(meta('user', { allowWhenSuspended: true }), suspended, 'POST')).toBeNull();
    expect(gate(meta('optional'), suspended, 'POST')).toBe('account_suspended');
    expect(gate(meta('optional'), suspended, 'GET')).toBeNull();
  });

  it('gate 7: onboarded', () => {
    expect(gate(meta('onboarded'), viewer({ onboardingStep: 'issues' }))).toBe(
      'onboarding_incomplete',
    );
    expect(gate(meta('onboarded'), viewer({ onboardingStep: 'done' }))).toBeNull();
    // A user route does not need finished onboarding.
    expect(gate(meta('user'), viewer({ onboardingStep: 'photo' }))).toBeNull();
    expect(
      gate(meta('onboarded'), viewer({ status: 'suspended', onboardingStep: 'issues' }), 'POST'),
    ).toBe('account_suspended');
  });

  it('isAdmin agrees with gate 4', () => {
    const fresh = ago(MINUTE_MS);
    for (const role of ['user', 'admin'] as const) {
      for (const listed of [true, false]) {
        for (const status of ['active', 'suspended'] as const) {
          const who = viewer({
            role,
            email: listed ? 'admin@example.test' : 'test_2@example.test',
            status,
            authenticatedAt: fresh,
          });
          const expected = role === 'admin' && listed && status === 'active';
          expect(isAdmin(who, NOW, ADMIN_EMAILS), `${role} ${String(listed)} ${status}`).toBe(
            expected,
          );
          expect(gate(meta('admin'), who, 'GET') === null).toBe(expected);
        }
      }
    }
    expect(
      isAdmin(admin({ authenticatedAt: ago(12 * HOUR_MS + SECOND_MS) }), NOW, ADMIN_EMAILS),
    ).toBe(false);
  });

  it('parseAdminEmails', () => {
    expect([...parseAdminEmails(['admin@example.test', 'b@example.test'])].sort()).toEqual([
      'admin@example.test',
      'b@example.test',
    ]);
    expect(parseAdminEmails(null).size).toBe(0);
    expect(parseAdminEmails([]).size).toBe(0);
  });
});
