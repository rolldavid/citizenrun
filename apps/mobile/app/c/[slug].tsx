import { useLocalSearchParams } from 'expo-router';

import { PersonScreen } from '@/features/profile';

export default function PersonRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <PersonScreen slug={slug} />;
}
