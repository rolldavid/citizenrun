import { useLocalSearchParams } from 'expo-router';

// The module itself, not the feature's index: a module that two lazy routes share moves into the
// chunk every page loads, and the index also carries the whole gallery (D-164).
import { FixtureScreen } from '@/features/dev/screens/fixture-screen';

export default function FixtureRoute() {
  const { screen, fixture, textScale } = useLocalSearchParams<{
    screen: string;
    fixture: string;
    textScale?: string;
  }>();
  return <FixtureScreen screen={screen} fixture={fixture} textScale={textScale} />;
}
