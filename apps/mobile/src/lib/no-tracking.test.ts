import { describe, expect, it } from 'vitest';

import manifest from '../../package.json';

// No advertising, analytics or crash-reporting SDK reaches the app (INV-09).

const DENY_SCOPES = [
  '@sentry',
  '@bugsnag',
  '@datadog',
  '@newrelic',
  '@amplitude',
  '@segment',
  '@react-native-firebase',
  '@firebase',
  '@braze',
  '@posthog',
  '@logrocket',
  '@fullstory',
  '@heap',
];
const DENY_NAMES = [
  'sentry-expo',
  'bugsnag-react-native',
  'dd-trace',
  'newrelic',
  'amplitude-js',
  'mixpanel',
  'mixpanel-browser',
  'mixpanel-react-native',
  'react-native-appsflyer',
  'react-native-adjust',
  'react-native-branch',
  'react-native-onesignal',
  'onesignal-expo-plugin',
  'posthog-js',
  'posthog-react-native',
  'logrocket',
  'react-native-google-mobile-ads',
  'expo-ads-admob',
  'expo-tracking-transparency',
  'expo-firebase-analytics',
  'react-native-idfa',
  'react-native-advertising-id',
  'firebase',
  'hotjar',
  'smartlook-react-native-wrapper',
];

const DEPENDENCY_MAPS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

// A package key of the lockfile: two spaces, an optional quote, the name, then '@' and the version.
const PACKAGE_KEY = /^ {2}'?((?:@[^\s'/@]+\/)?[^\s'/@]+)@/gm;

const lockfiles = import.meta.glob('../../../../pnpm-lock.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const lockfile = Object.values(lockfiles)[0] ?? '';

function isDenied(name: string): boolean {
  return DENY_NAMES.includes(name) || DENY_SCOPES.some((scope) => name.startsWith(`${scope}/`));
}

function namesOf(map: unknown): string[] {
  return typeof map === 'object' && map !== null ? Object.keys(map) : [];
}

function lockfilePackageNames(text: string): string[] {
  return [...text.matchAll(PACKAGE_KEY)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

describe('no tracking SDK', () => {
  it('the app declares no tracking SDK', () => {
    const fields: Readonly<Record<string, unknown>> = manifest;
    const declared = DEPENDENCY_MAPS.flatMap((map) => namesOf(fields[map]));
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter(isDenied)).toEqual([]);
  });

  it('nothing in the lockfile is a tracking SDK', () => {
    expect(lockfilePackageNames(lockfile).filter(isDenied)).toEqual([]);
  });

  it('the deny-list is not empty', () => {
    expect(DENY_SCOPES.length).toBeGreaterThan(0);
    expect(DENY_NAMES.length).toBeGreaterThan(0);
    expect(Object.keys(lockfiles)).toHaveLength(1);
    const names = lockfilePackageNames(lockfile);
    expect(names.length).toBeGreaterThan(0);
    expect(names).toContain('react-native');
    expect(names).toContain('@tanstack/react-query');
  });

  it('the scan recognises a tracking SDK in either form of key', () => {
    const sample = [
      'packages:',
      '',
      "  '@sentry/react-native@7.0.0':",
      '    resolution: {integrity: sha512-x}',
      '',
      '  mixpanel@2.0.0:',
      '    resolution: {integrity: sha512-y}',
      '',
      '  zod@4.0.0:',
    ].join('\n');
    expect(lockfilePackageNames(sample).filter(isDenied)).toEqual([
      '@sentry/react-native',
      'mixpanel',
    ]);
  });
});
