import { createElement } from 'react';
import type { ComponentType, ReactElement } from 'react';

import { HelloScreenView, helloFixtures } from '@/features/hello';
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
  NotFoundScreenView,
  SystemErrorScreenView,
  SystemUpdateScreenView,
  notFoundFixtures,
  rootFixtures,
  systemErrorFixtures,
  systemUpdateFixtures,
} from '@/features/system';
import type { RootViewModel } from '@/features/system';
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

/** A screen whose <Name>ScreenView takes a view-model; `fixtures` is its <name>.fixtures.ts module. */
export function defineScreen<VM>(
  view: ComponentType<{ vm: VM }>,
  fixtures: Readonly<Record<string, VM>>,
  shell?: ScreenShell,
): ScreenRegistryEntry {
  // The names a fixtures module lists: what it exports, and nothing it only carries.
  const names = Object.keys(fixtures);
  return {
    fixtures: names,
    render: (fixture) => {
      if (!names.includes(fixture)) {
        return null;
      }
      return createElement(view, { vm: fixtures[fixture] as VM });
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

/** Screen id to its view and named fixtures. Each screen adds its row with its view. */
export const SCREEN_FIXTURES: Readonly<Record<string, ScreenRegistryEntry>> = {
  hello: defineScreen(HelloScreenView, helloFixtures, { mode: 'app', active: 'home' }),
  'root-layout': defineScreen(RootLayoutView, rootFixtures, { mode: 'own' }),
  'not-found': defineStaticScreen(NotFoundScreenView, Object.keys(notFoundFixtures)),
  'system-update': defineScreen(SystemUpdateScreenView, systemUpdateFixtures),
  'system-error': defineScreen(SystemErrorScreenView, systemErrorFixtures),
  'onboarding-photo': defineScreen(OnboardingPhotoScreenView, photoFixtures, { mode: 'bare' }),
  'onboarding-handle': defineScreen(OnboardingHandleScreenView, handleFixtures, { mode: 'bare' }),
  'onboarding-issues': defineScreen(OnboardingIssuesScreenView, issuesFixtures, { mode: 'bare' }),
  'onboarding-location': defineScreen(OnboardingLocationScreenView, locationFixtures, {
    mode: 'bare',
  }),
};
