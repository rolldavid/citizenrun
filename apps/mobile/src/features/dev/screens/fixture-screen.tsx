import type { JSX } from 'react';
import { View } from 'react-native';

import { SCREEN_FIXTURES } from '@/features/dev/screen-fixtures';
import type { ScreenRegistryEntry } from '@/features/dev/screen-fixtures';
import { Text } from '@/ui/components/text';

export type FixtureScreenProps = {
  screen: string;
  fixture: string;
  /** Default SCREEN_FIXTURES. */
  registry?: Readonly<Record<string, ScreenRegistryEntry>>;
};

/** SCR-dev-screens: one screen drawn from one named fixture, or the `unknownPair` line. */
export function FixtureScreen({
  screen,
  fixture,
  registry = SCREEN_FIXTURES,
}: FixtureScreenProps): JSX.Element {
  const entry = Object.hasOwn(registry, screen) ? registry[screen] : undefined;
  const drawn = entry?.render(fixture) ?? null;
  if (drawn !== null) {
    return drawn;
  }
  return (
    <View testID="dev.fixture-unknown">
      <Text role="body">{`No fixture "${fixture}" for screen "${screen}".`}</Text>
    </View>
  );
}
