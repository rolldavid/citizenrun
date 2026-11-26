import { useLocalSearchParams } from 'expo-router';

import { WelcomeScreen } from '@/features/auth';
import { searchParamOf } from '@/lib/navigation';

export default function WelcomeRoute() {
  const { next } = useLocalSearchParams<{ next?: string | string[] }>();
  return <WelcomeScreen next={searchParamOf(next)} />;
}
