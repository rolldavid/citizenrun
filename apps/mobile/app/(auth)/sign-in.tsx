import { useLocalSearchParams } from 'expo-router';

import { SignInScreen } from '@/features/auth';

export default function SignInRoute() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  return <SignInScreen next={next ?? null} />;
}
