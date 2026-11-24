// The module itself, not the feature's index: a module that two lazy routes share moves into the
// chunk every page loads, and the index also carries the whole gallery (D-164).
import { ListSpikeScreen } from '@/features/dev/screens/list-spike-screen';

export default function ListSpikeRoute() {
  return <ListSpikeScreen />;
}
