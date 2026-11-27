import { createElement } from 'react';
import type { ComponentType, ReactElement } from 'react';

import {
  ReauthSheet,
  SignInScreenView,
  WelcomeScreenView,
  reauthFixtures,
  signInFixtures,
  welcomeFixtures,
} from '@/features/auth';
import { HomeScreenView, homeFixtures } from '@/features/feed';
import { OfficeScreenView, officeFixtures } from '@/features/office';
import {
  OnboardingHandleScreenView,
  OnboardingIssuesScreenView,
  OnboardingLocationScreenView,
  OnboardingPhotoScreenView,
  handleFixtures,
  issuesFixtures,
  locationFixtures,
  photoFixtures,
} from '@/features/onboarding';
import {
  SettingsAboutScreenView,
  SettingsAccountScreenView,
  SettingsAppearanceScreenView,
  SettingsDeleteAccountScreenView,
  SettingsExportScreenView,
  SettingsIssuesScreenView,
  SettingsPrivacyScreenView,
  SettingsProfileScreenView,
  SettingsScreenView,
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
  AdultsOnlyScreenView,
  AgreementsScreenView,
  NotFoundScreenView,
  SystemErrorScreenView,
  SystemUpdateScreenView,
  UnavailableInStateScreenView,
  adultsOnlyFixtures,
  agreementsFixtures,
  notFoundFixtures,
  rootFixtures,
  stateUnavailableFixtures,
  systemErrorFixtures,
  systemUpdateFixtures,
} from '@/features/system';
import type { RootViewModel } from '@/features/system';
import { NowOverrideContext } from '@/lib/now';
import type { NavItemId } from '@/ui/shells/app-shell';

import { RootLayoutFixtureView } from './screens/fixture-screen';

/** What stands around a fixture: the app's shell, nothing, or a shell the view draws itself. */
export type ScreenShell =
  { mode: 'app'; active: NavItemId | null } | { mode: 'bare' } | { mode: 'own' };

export type ScreenRegistryEntry = {
  fixtures: readonly string[];
  render: (fixture: string) => ReactElement | null;
  /** Absent: 'bare'. */
  shell?: ScreenShell;
};

/** How a screen's fixtures are drawn. */
export type ScreenOptions = {
  /** The time useNow answers inside every fixture of the screen, so day counts never move. */
  now?: Date;
};

/** A screen whose <Name>ScreenView takes a view-model; `fixtures` is its <name>.fixtures.ts module. */
export function defineScreen<VM>(
  view: ComponentType<{ vm: VM }>,
  fixtures: Readonly<Record<string, VM>>,
  shell?: ScreenShell,
  options?: ScreenOptions,
): ScreenRegistryEntry {
  // The names a fixtures module lists: what it exports, and nothing it only carries.
  const names = Object.keys(fixtures);
  const now = options?.now ?? null;
  return {
    fixtures: names,
    render: (fixture) => {
      if (!names.includes(fixture)) {
        return null;
      }
      const drawn = createElement(view, { vm: fixtures[fixture] as VM });
      return now === null
        ? drawn
        : createElement(NowOverrideContext.Provider, { value: now }, drawn);
    },
    ...(shell === undefined ? {} : { shell }),
  };
}

/** A screen with no view-model (SCR-not-found); it has one look per listed fixture name. */
export function defineStaticScreen(
  view: ComponentType,
  fixtureNames: readonly string[],
  shell?: ScreenShell,
): ScreenRegistryEntry {
  const names = [...fixtureNames];
  return {
    fixtures: names,
    render: (fixture) => (names.includes(fixture) ? createElement(view) : null),
    ...(shell === undefined ? {} : { shell }),
  };
}

// The renderer and this registry import each other, so the renderer's view is read when it is
// drawn, not when this module loads.
function RootLayoutView(props: { vm: RootViewModel }): ReactElement {
  return createElement(RootLayoutFixtureView, props);
}

/** The time the office fixtures are written at: twelve days before their filing deadline. */
const OFFICE_FIXTURE_TIME = new Date('2026-11-15T17:00:00.000Z');

/** The shell of every settings screen: the app's, with Profile as the active item. */
const SETTINGS_SHELL: ScreenShell = { mode: 'app', active: 'profile' };

/** Screen id to its view and named fixtures. Each screen adds its row with its view. */
export const SCREEN_FIXTURES: Readonly<Record<string, ScreenRegistryEntry>> = {
  home: defineScreen(HomeScreenView, homeFixtures, { mode: 'app', active: 'home' }),
  'root-layout': defineScreen(RootLayoutView, rootFixtures, { mode: 'own' }),
  'not-found': defineStaticScreen(NotFoundScreenView, Object.keys(notFoundFixtures)),
  'system-update': defineScreen(SystemUpdateScreenView, systemUpdateFixtures),
  'system-error': defineScreen(SystemErrorScreenView, systemErrorFixtures),
  'system-adults-only': defineScreen(AdultsOnlyScreenView, adultsOnlyFixtures, { mode: 'bare' }),
  // The agreements sheet is drawn over the route's ground; the root layout fixture shows it over Home.
  'system-agreements': defineScreen(AgreementsScreenView, agreementsFixtures, { mode: 'bare' }),
  'system-unavailable-in-state': defineScreen(
    UnavailableInStateScreenView,
    stateUnavailableFixtures,
    { mode: 'bare' },
  ),
  // A pushed page: a direct load of it keeps no navigation item lit (PC6B-11).
  'office-slug': defineScreen(
    OfficeScreenView,
    officeFixtures,
    { mode: 'app', active: null },
    { now: OFFICE_FIXTURE_TIME },
  ),
  welcome: defineScreen(WelcomeScreenView, welcomeFixtures, { mode: 'bare' }),
  'sign-in': defineScreen(SignInScreenView, signInFixtures, { mode: 'bare' }),
  // The re-authentication sheet is a view of its own, drawn over the route's ground.
  'sign-in-reauth': defineScreen(ReauthSheet, reauthFixtures, { mode: 'bare' }),
  'onboarding-photo': defineScreen(OnboardingPhotoScreenView, photoFixtures, { mode: 'bare' }),
  'onboarding-handle': defineScreen(OnboardingHandleScreenView, handleFixtures, { mode: 'bare' }),
  'onboarding-issues': defineScreen(OnboardingIssuesScreenView, issuesFixtures, { mode: 'bare' }),
  'onboarding-location': defineScreen(OnboardingLocationScreenView, locationFixtures, {
    mode: 'bare',
  }),
  settings: defineScreen(SettingsScreenView, settingsFixtures, SETTINGS_SHELL),
  'settings-profile': defineScreen(
    SettingsProfileScreenView,
    settingsProfileFixtures,
    SETTINGS_SHELL,
  ),
  'settings-issues': defineScreen(SettingsIssuesScreenView, settingsIssuesFixtures, SETTINGS_SHELL),
  'settings-account': defineScreen(
    SettingsAccountScreenView,
    settingsAccountFixtures,
    SETTINGS_SHELL,
  ),
  'settings-appearance': defineScreen(
    SettingsAppearanceScreenView,
    settingsAppearanceFixtures,
    SETTINGS_SHELL,
  ),
  'settings-privacy': defineScreen(
    SettingsPrivacyScreenView,
    settingsPrivacyFixtures,
    SETTINGS_SHELL,
  ),
  'settings-export': defineScreen(SettingsExportScreenView, settingsExportFixtures, SETTINGS_SHELL),
  'settings-delete-account': defineScreen(
    SettingsDeleteAccountScreenView,
    settingsDeleteAccountFixtures,
    SETTINGS_SHELL,
  ),
  'settings-about': defineScreen(SettingsAboutScreenView, settingsAboutFixtures, SETTINGS_SHELL),
};
