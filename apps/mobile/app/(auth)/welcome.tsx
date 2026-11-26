import { useLocalSearchParams } from 'expo-router';

import { WelcomeScreen } from '@/features/auth';

export default function WelcomeRoute() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  return <WelcomeScreen next={next ?? null} />;
}
