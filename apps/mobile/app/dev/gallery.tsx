import { useLocalSearchParams } from 'expo-router';

import { GalleryScreen } from '@/features/dev';

export default function GalleryRoute() {
  const { theme, textScale, reducedMotion, only } = useLocalSearchParams();
  return (
    <GalleryScreen
      initialTheme={theme === 'light' || theme === 'dark' ? theme : 'system'}
      initialTextScale={textScale === '1.3' ? 1.3 : 1}
      initialReducedMotion={reducedMotion === '1' ? true : null}
      only={typeof only === 'string' && only !== '' ? only : null}
    />
  );
}
