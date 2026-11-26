import { useLocalSearchParams } from 'expo-router';

import { SignInScreen } from '@/features/auth';
import { searchParamOf } from '@/lib/navigation';

export default function SignInRoute() {
  const { next } = useLocalSearchParams<{ next?: string | string[] }>();
  return <SignInScreen next={searchParamOf(next)} />;
}
