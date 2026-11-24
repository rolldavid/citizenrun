import { useLocalSearchParams } from 'expo-router';

// The module itself, not the feature's index: a module that two lazy routes share moves into the
// chunk every page loads, and the index also carries the whole gallery (D-164).
import { MapSpikeScreen } from '@/features/dev/screens/map-spike-screen';
import { session } from '@/platform/session';

export default function MapSpikeRoute() {
  const { spikeOrigin } = useLocalSearchParams<{ spikeOrigin?: string }>();
  return <MapSpikeScreen apiOrigin={session.apiOrigin} spikeOrigin={spikeOrigin ?? null} />;
}
