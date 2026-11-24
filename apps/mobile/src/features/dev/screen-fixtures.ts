import { createElement } from 'react';
import type { ComponentType, ReactElement } from 'react';

export type ScreenRegistryEntry = {
  fixtures: readonly string[];
  render: (fixture: string) => ReactElement | null;
};

/** A screen whose <Name>ScreenView takes a view-model; `fixtures` is its <name>.fixtures.ts module. */
export function defineScreen<VM>(
  view: ComponentType<{ vm: VM }>,
  fixtures: Readonly<Record<string, VM>>,
): ScreenRegistryEntry {
  return {
    fixtures: Object.keys(fixtures),
    render: (fixture) => {
      if (!Object.hasOwn(fixtures, fixture)) {
        return null;
      }
      return createElement(view, { vm: fixtures[fixture] as VM });
    },
  };
}

/** A screen with no view-model (SCR-not-found); it has one look per listed fixture name. */
export function defineStaticScreen(
  view: ComponentType,
  fixtureNames: readonly string[],
): ScreenRegistryEntry {
  const names = [...fixtureNames];
  return {
    fixtures: names,
    render: (fixture) => (names.includes(fixture) ? createElement(view) : null),
  };
}

/** Screen id to its view and named fixtures. Each screen's work package adds its row. */
export const SCREEN_FIXTURES: Readonly<Record<string, ScreenRegistryEntry>> = {};
