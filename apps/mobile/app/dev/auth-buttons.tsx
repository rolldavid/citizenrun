// The module itself, not the feature's index: a module that two lazy routes share moves into the
// chunk every page loads, and the index also carries the whole gallery (D-164).
import { AuthButtonsScreen } from '@/features/dev/screens/auth-buttons-screen';

export default function AuthButtonsRoute() {
  return <AuthButtonsScreen />;
}
