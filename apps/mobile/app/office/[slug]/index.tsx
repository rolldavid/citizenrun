import { useLocalSearchParams } from 'expo-router';

import { OfficeScreen } from '@/features/office';

export default function OfficeRoute() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <OfficeScreen slug={slug} />;
}
