import { describe, expect, it, vi } from 'vitest';

import * as ui from '@/ui';

// This project runs in Node with no bundler, where the native libraries the components draw with
// do not load. Nothing is drawn here: each is replaced by a stand-in that answers to any name, so
// the modules of `@/ui` load and what they export can be listed.
const standIn = vi.hoisted(() => (): object => {
  // A value that can be read, called and built, and gives itself back each time.
  const anything: object = new Proxy(function standInValue() {}, {
    get: (_target, key) => {
      if (typeof key === 'symbol' || key === 'then') return undefined;
      if (key === 'toString' || key === 'valueOf') return () => '';
      return anything;
    },
    has: () => true,
    apply: () => anything,
    construct: () => anything,
  });
  // The module: every name it is asked for is there.
  return new Proxy(
    {},
    {
      get: (_target, key) => (typeof key === 'symbol' || key === 'then' ? undefined : anything),
      has: () => true,
    },
  );
});

vi.mock('react-native-reanimated', standIn);
vi.mock('react-native-worklets', standIn);
vi.mock('react-native-svg', standIn);
vi.mock('react-native-safe-area-context', standIn);
vi.mock('expo-router', standIn);
vi.mock('expo-status-bar', standIn);

/** The civic components, in the order the design system lists them, then the still of the mini map. */
const COMPONENTS = [
  'AddressField',
  'PersonRow',
  'FactRow',
  'Table',
  'Tag',
  'Flag',
  'ConfidenceBadge',
  'SourceLink',
  'SourcesSheet',
  'PhotoCredit',
  'BigNumber',
  'DealLine',
  'Meter',
  'MeterInputs',
  'DeadlineRing',
  'DeadlineBlock',
  'DeadlineLine',
  'OfficeTile',
  'ProfileHeader',
  'CardShell',
  'ActionRow',
  'FollowButton',
  'OfficeCard',
  'MiniMapStill',
] as const;

/** What a screen or a presenter calls beside them. */
const HELPERS = ['toDisplayValue', 'closingLineText', 'closingRowText', 'miniMapText'] as const;

describe('@/ui', () => {
  it('the civic components are in @/ui', () => {
    expect(COMPONENTS).toHaveLength(24);
    expect(new Set<string>(COMPONENTS).size).toBe(COMPONENTS.length);
    const exported: Readonly<Record<string, unknown>> = ui;
    for (const name of [...COMPONENTS, ...HELPERS]) {
      expect(exported[name], name).toBeTypeOf('function');
    }
    expect(ui.ADDRESS_QUIET_MS).toBe(250);
  });

  it('the fixture canvas stays out of @/ui', () => {
    const names = Object.keys(ui);
    expect(names).not.toContain('FixtureRunAgainstCanvas');
    expect(names).not.toContain('fixtureOffice');
    expect(names).not.toContain('FIXTURE_ALT_TEXT');
    expect(names).not.toContain('FIXTURE_NOW');
  });
});
