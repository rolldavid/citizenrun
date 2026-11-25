import { describe, expect, it } from 'vitest';
import { ROUTE_CLASSES, routeClassOf } from './route-classes.ts';
import type { RouteClass } from './route-classes.ts';

const CASES: ReadonlyArray<[string, RouteClass]> = [
  ['/', 'public'],
  ['/office/county-treasurer', 'public'],
  ['/c/fixture-person', 'public'],
  ['/u/test_user', 'public'],
  ['/p/0195a7e0-0000-7000-8000-000000000001', 'public'],
  ['/welcome', 'auth'],
  ['/sign-in', 'auth'],
  ['/onboarding/photo', 'onboarding'],
  ['/onboarding/handle', 'onboarding'],
  ['/onboarding/issues', 'onboarding'],
  ['/onboarding/location', 'onboarding'],
  ['/explore', 'session'],
  ['/create', 'session'],
  ['/activity', 'session'],
  ['/profile', 'session'],
  ['/messages', 'session'],
  ['/messages/requests', 'session'],
  ['/messages/0195a7e0-0000-7000-8000-000000000001', 'session'],
  ['/office/county-treasurer/run', 'session'],
  ['/settings', 'session'],
  ['/settings/delete-account', 'session'],
  ['/settings/a/b', 'session'],
  ['/dev/gallery', 'dev'],
  ['/dev/screens/office/fixture', 'dev'],
];

describe('routeClassOf', () => {
  for (const [path, routeClass] of CASES) {
    it(path, () => {
      expect(routeClassOf(path)).toBe(routeClass);
    });
  }

  it('unknown paths', () => {
    for (const path of [
      '/admin',
      '/admin/reports',
      '/office',
      '/office/a/b/c',
      '/u',
      '/dev',
      '/SETTINGS',
      '/settings//x',
      '/nope',
      'settings',
      '',
      '//example.org',
      '/office/a/run/x',
    ]) {
      expect(routeClassOf(path), path).toBe('unknown');
    }
  });

  it('query and fragment are ignored', () => {
    expect(routeClassOf('/c/fixture-person?tab=posts#top')).toBe('public');
    expect(routeClassOf('/explore#top')).toBe('session');
    expect(routeClassOf('/?next=%2Fexplore')).toBe('public');
    expect(routeClassOf('/admin?x=/explore')).toBe('unknown');
  });

  it('one trailing slash is ignored', () => {
    expect(routeClassOf('/onboarding/photo/')).toBe('onboarding');
    expect(routeClassOf('/')).toBe('public');
    expect(routeClassOf('/onboarding/photo//')).toBe('unknown');
  });

  it('percent-encoding is not decoded', () => {
    expect(routeClassOf('/u/a%2Fb')).toBe('public');
    expect(routeClassOf('/%73ettings')).toBe('unknown');
  });

  it('the table is the L-route-classes table', () => {
    expect(ROUTE_CLASSES.map((row) => row.routeClass)).toEqual([
      'public',
      'auth',
      'onboarding',
      'session',
      'dev',
    ]);
    const patterns = Object.fromEntries(ROUTE_CLASSES.map((row) => [row.routeClass, row.patterns]));
    expect(patterns).toEqual({
      public: ['/', '/office/:slug', '/c/:slug', '/u/:handle', '/p/:id'],
      auth: ['/welcome', '/sign-in'],
      onboarding: [
        '/onboarding/photo',
        '/onboarding/handle',
        '/onboarding/issues',
        '/onboarding/location',
      ],
      session: [
        '/explore',
        '/create',
        '/activity',
        '/profile',
        '/messages',
        '/messages/requests',
        '/messages/:id',
        '/office/:slug/run',
        '/settings',
        '/settings/*',
      ],
      dev: ['/dev/*'],
    });
  });
});
