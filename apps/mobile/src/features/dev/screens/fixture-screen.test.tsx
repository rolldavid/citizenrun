import { act, cleanup, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SCREEN_FIXTURES, defineScreen, defineStaticScreen } from '@/features/dev/screen-fixtures';
import type { ScreenRegistryEntry } from '@/features/dev/screen-fixtures';
import { reauthFixtures, signInFixtures, welcomeFixtures } from '@/features/auth';
import { homeFixtures } from '@/features/feed';
import {
  handleFixtures,
  issuesFixtures,
  locationFixtures,
  photoFixtures,
} from '@/features/onboarding';
import {
  settingsAboutFixtures,
  settingsAccountFixtures,
  settingsAppearanceFixtures,
  settingsDeleteAccountFixtures,
  settingsExportFixtures,
  settingsFixtures,
  settingsIssuesFixtures,
  settingsPrivacyFixtures,
  settingsProfileFixtures,
} from '@/features/settings';
import {
  adultsOnlyFixtures,
  agreementsFixtures,
  notFoundFixtures,
  rootFixtures,
  stateUnavailableFixtures,
  systemErrorFixtures,
  systemUpdateFixtures,
} from '@/features/system';
import { renderWithProviders, setViewport } from '@/test/render';
import { Text } from '@/ui/components/text';
import { showToast, ToastHost } from '@/ui/components/toast';

import { FixtureScreen, FixtureView } from './fixture-screen';

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

type StubVm = { label: string };

function StubView({ vm }: { vm: StubVm }): JSX.Element {
  return (
    <Text role="body" testID="stub.label">
      {vm.label}
    </Text>
  );
}

function StaticView(): JSX.Element {
  return (
    <Text role="body" testID="static.body">
      Static
    </Text>
  );
}

const STUB_FIXTURES = { stubReady: { label: 'Ready' }, stubLong: { label: 'Long' } } as const;

const REGISTRY: Readonly<Record<string, ScreenRegistryEntry>> = {
  stub: defineScreen(StubView, STUB_FIXTURES),
  static: defineStaticScreen(StaticView, ['staticDefault']),
  inApp: defineScreen(StubView, STUB_FIXTURES, { mode: 'app', active: 'explore' }),
  bare: defineScreen(StubView, STUB_FIXTURES, { mode: 'bare' }),
  own: defineScreen(StubView, STUB_FIXTURES, { mode: 'own' }),
};

const COMPACT = [390, 844] as const;
const EXPANDED = [1440, 900] as const;

/** The not-found content, or null when it is not drawn. */
function notFound(): HTMLElement | null {
  return screen.queryByTestId('system.not-found');
}

/** The size the stub's text is drawn at. */
function stubFontSize(): string {
  return screen.getByTestId('stub.label').style.fontSize;
}

afterEach(() => {
  cleanup();
});

describe('FixtureScreen', () => {
  it('shows not found for a pair the default registry does not hold', () => {
    renderWithProviders(<FixtureScreen screen="home" fixture="nope" />);
    expect(notFound()).not.toBeNull();
    expect(screen.queryByTestId('feed.home')).toBeNull();
  });

  it('renders a known pair through defineScreen with that fixture', () => {
    renderWithProviders(<FixtureScreen screen="stub" fixture="stubReady" registry={REGISTRY} />);
    expect(screen.getByTestId('stub.label').textContent).toBe('Ready');
    expect(notFound()).toBeNull();
  });

  it('renders another fixture of the same screen with its own view-model', () => {
    renderWithProviders(<FixtureScreen screen="stub" fixture="stubLong" registry={REGISTRY} />);
    expect(screen.getByTestId('stub.label').textContent).toBe('Long');
  });

  it('shows not found for a fixture the screen does not list', () => {
    renderWithProviders(<FixtureScreen screen="stub" fixture="other" registry={REGISTRY} />);
    expect(notFound()).not.toBeNull();
    expect(screen.queryByTestId('stub.label')).toBeNull();
  });

  it('renders a static screen for its listed fixture only', () => {
    renderWithProviders(
      <FixtureScreen screen="static" fixture="staticDefault" registry={REGISTRY} />,
    );
    expect(screen.getByTestId('static.body').textContent).toBe('Static');
    cleanup();
    renderWithProviders(
      <FixtureScreen screen="static" fixture="staticOther" registry={REGISTRY} />,
    );
    expect(screen.queryByTestId('static.body')).toBeNull();
    expect(notFound()).not.toBeNull();
  });

  it('treats inherited object keys as unknown screens and fixtures', () => {
    renderWithProviders(
      <FixtureScreen screen="constructor" fixture="stubReady" registry={REGISTRY} />,
    );
    expect(notFound()).not.toBeNull();
    cleanup();
    renderWithProviders(<FixtureScreen screen="stub" fixture="toString" registry={REGISTRY} />);
    expect(notFound()).not.toBeNull();
    expect(screen.queryByTestId('stub.label')).toBeNull();
  });

  it('a text scale of 1.3 reaches the theme', () => {
    renderWithProviders(
      <FixtureScreen screen="stub" fixture="stubReady" registry={REGISTRY} textScale="1.3" />,
    );
    expect(stubFontSize()).toBe('20.8px');
    for (const refused of ['9', 'x', '0.5', '']) {
      cleanup();
      renderWithProviders(
        <FixtureScreen screen="stub" fixture="stubReady" registry={REGISTRY} textScale={refused} />,
      );
      expect(stubFontSize()).toBe('16px');
    }
    cleanup();
    renderWithProviders(<FixtureScreen screen="stub" fixture="stubReady" registry={REGISTRY} />);
    expect(stubFontSize()).toBe('16px');
  });

  it('a toast raised over a scaled fixture is drawn at the fixture’s text size', () => {
    const raise = (): HTMLElement => {
      act(() => {
        showToast({ kind: 'success', text: 'Saved.' });
      });
      return screen.getByText('Saved.');
    };
    renderWithProviders(
      <ToastHost>
        <FixtureScreen screen="stub" fixture="stubReady" registry={REGISTRY} textScale="1.3" />
      </ToastHost>,
    );
    expect(raise().style.fontSize).toBe('18.2px');
    expect(screen.getAllByText('Saved.')).toHaveLength(1);
    cleanup();
    renderWithProviders(
      <ToastHost>
        <FixtureScreen screen="stub" fixture="stubReady" registry={REGISTRY} />
      </ToastHost>,
    );
    expect(raise().style.fontSize).toBe('14px');
  });

  it('keeps the theme it is drawn in when it scales the text', () => {
    renderWithProviders(
      <FixtureScreen screen="stub" fixture="stubReady" registry={REGISTRY} textScale="1.3" />,
      { theme: 'dark' },
    );
    const scaled = screen.getByTestId('stub.label').style.color;
    cleanup();
    renderWithProviders(<FixtureScreen screen="stub" fixture="stubReady" registry={REGISTRY} />, {
      theme: 'dark',
    });
    expect(scaled).toBe(screen.getByTestId('stub.label').style.color);
    cleanup();
    renderWithProviders(<FixtureScreen screen="stub" fixture="stubReady" registry={REGISTRY} />);
    expect(scaled).not.toBe(screen.getByTestId('stub.label').style.color);
  });
});

describe('FixtureView', () => {
  it('draws an app entry inside the shell of the app, with its item active', () => {
    setViewport(...EXPANDED);
    renderWithProviders(<FixtureView screen="inApp" fixture="stubReady" registry={REGISTRY} />);
    expect(screen.getByTestId('shell.rail')).toBeTruthy();
    expect(screen.getByTestId('shell.rail-explore').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('shell.rail-home').getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('main').contains(screen.getByTestId('stub.label'))).toBe(true);
  });

  it('draws a bare entry, an own entry and an entry that names no shell alone', () => {
    setViewport(...EXPANDED);
    for (const id of ['bare', 'own', 'stub']) {
      cleanup();
      renderWithProviders(<FixtureView screen={id} fixture="stubReady" registry={REGISTRY} />);
      expect(screen.getByTestId('stub.label').textContent).toBe('Ready');
      expect(screen.queryByTestId('shell.rail')).toBeNull();
      expect(screen.queryByTestId('shell.skip-link')).toBeNull();
    }
  });

  it('draws a Home fixture of the default registry inside the shell, with Home active', () => {
    setViewport(...EXPANDED);
    renderWithProviders(<FixtureView screen="home" fixture="homePlaceholder" />);
    expect(screen.getByTestId('feed.home')).toBeTruthy();
    expect(screen.getByTestId('shell.rail-home').getAttribute('aria-current')).toBe('page');
    cleanup();
    setViewport(...COMPACT);
    renderWithProviders(<FixtureView screen="home" fixture="homePlaceholder" />);
    expect(screen.getByTestId('feed.home')).toBeTruthy();
    expect(screen.queryByTestId('shell.rail')).toBeNull();
  });

  it('draws the system screens of the default registry with no shell', () => {
    setViewport(...EXPANDED);
    renderWithProviders(<FixtureView screen="system-update" fixture="updateWithStore" />);
    expect(screen.getByTestId('system.update')).toBeTruthy();
    expect(screen.queryByTestId('shell.rail')).toBeNull();
    cleanup();
    renderWithProviders(<FixtureView screen="system-error" fixture="systemError" />);
    expect(screen.getByTestId('system.error')).toBeTruthy();
    cleanup();
    renderWithProviders(<FixtureView screen="not-found" fixture="notFoundDefault" />);
    expect(notFound()).not.toBeNull();
  });

  it('draws the root layout fixture with the one shell it brings', () => {
    setViewport(...EXPANDED);
    renderWithProviders(<FixtureView screen="root-layout" fixture="rootSignedOut" />);
    expect(screen.getAllByTestId('shell.rail')).toHaveLength(1);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByTestId('feed.home')).toBeTruthy();
  });
});

describe('the registry', () => {
  it('holds every screen with every fixture of its view-model', () => {
    const listed = Object.fromEntries(
      Object.entries(SCREEN_FIXTURES).map(([id, entry]) => [id, [...entry.fixtures].sort()]),
    );
    expect(listed).toEqual({
      home: Object.keys(homeFixtures).sort(),
      'root-layout': Object.keys(rootFixtures).sort(),
      'not-found': Object.keys(notFoundFixtures).sort(),
      'system-update': Object.keys(systemUpdateFixtures).sort(),
      'system-error': Object.keys(systemErrorFixtures).sort(),
      'system-adults-only': Object.keys(adultsOnlyFixtures).sort(),
      'system-agreements': Object.keys(agreementsFixtures).sort(),
      'system-unavailable-in-state': Object.keys(stateUnavailableFixtures).sort(),
      welcome: Object.keys(welcomeFixtures).sort(),
      'sign-in': Object.keys(signInFixtures).sort(),
      'sign-in-reauth': Object.keys(reauthFixtures).sort(),
      'onboarding-photo': Object.keys(photoFixtures).sort(),
      'onboarding-handle': Object.keys(handleFixtures).sort(),
      'onboarding-issues': Object.keys(issuesFixtures).sort(),
      'onboarding-location': Object.keys(locationFixtures).sort(),
      settings: Object.keys(settingsFixtures).sort(),
      'settings-profile': Object.keys(settingsProfileFixtures).sort(),
      'settings-issues': Object.keys(settingsIssuesFixtures).sort(),
      'settings-account': Object.keys(settingsAccountFixtures).sort(),
      'settings-appearance': Object.keys(settingsAppearanceFixtures).sort(),
      'settings-privacy': Object.keys(settingsPrivacyFixtures).sort(),
      'settings-export': Object.keys(settingsExportFixtures).sort(),
      'settings-delete-account': Object.keys(settingsDeleteAccountFixtures).sort(),
      'settings-about': Object.keys(settingsAboutFixtures).sort(),
    });
    for (const entry of Object.values(SCREEN_FIXTURES)) {
      expect(entry.fixtures.length).toBeGreaterThan(0);
      for (const fixture of entry.fixtures) {
        expect(entry.render(fixture)).not.toBeNull();
      }
    }
  });

  it('names the shell of each screen', () => {
    expect(SCREEN_FIXTURES.home?.shell).toEqual({ mode: 'app', active: 'home' });
    expect(SCREEN_FIXTURES.settings?.shell).toEqual({ mode: 'app', active: 'profile' });
    expect(SCREEN_FIXTURES.welcome?.shell).toEqual({ mode: 'bare' });
    expect(SCREEN_FIXTURES['root-layout']?.shell).toEqual({ mode: 'own' });
    expect(SCREEN_FIXTURES['not-found']?.shell).toBeUndefined();
    expect(SCREEN_FIXTURES['system-update']?.shell).toBeUndefined();
    expect(SCREEN_FIXTURES['system-error']?.shell).toBeUndefined();
  });
});

describe('the registry helpers', () => {
  it('lists the fixture names of each entry', () => {
    expect(REGISTRY.stub?.fixtures).toEqual(['stubReady', 'stubLong']);
    expect(REGISTRY.static?.fixtures).toEqual(['staticDefault']);
  });

  it('render returns null for a name the entry does not hold', () => {
    expect(REGISTRY.stub?.render('stubReady')).not.toBeNull();
    expect(REGISTRY.stub?.render('missing')).toBeNull();
    expect(REGISTRY.static?.render('staticDefault')).not.toBeNull();
    expect(REGISTRY.static?.render('missing')).toBeNull();
  });

  it('a key a fixtures module only carries is not a fixture', () => {
    // A module compiled to CommonJS carries this marker beside its exports.
    const carried: Record<string, StubVm> = { ...STUB_FIXTURES };
    Object.defineProperty(carried, '__esModule', { value: true });
    const entry = defineScreen(StubView, carried);
    expect(entry.fixtures).toEqual(['stubReady', 'stubLong']);
    expect(entry.render('__esModule')).toBeNull();
  });

  it('a static entry keeps its names when the caller changes its own list', () => {
    const names = ['first'];
    const entry = defineStaticScreen(StaticView, names);
    names.push('second');
    expect(entry.fixtures).toEqual(['first']);
    expect(entry.render('second')).toBeNull();
  });

  it('an entry carries the shell it is given, and none when it is given none', () => {
    expect(REGISTRY.inApp?.shell).toEqual({ mode: 'app', active: 'explore' });
    expect(REGISTRY.stub).not.toHaveProperty('shell');
    expect(defineStaticScreen(StaticView, ['one'], { mode: 'own' }).shell).toEqual({ mode: 'own' });
  });
});
