import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/ui/components/text';
import { useTheme } from '@/ui/theme';
import { gutter } from '@/ui/tokens';

import { spikeServerOrigin } from './spike-server';

export type MapSpikeScreenProps = {
  /** The API origin of this target: '' on the web, where the page and the API share one. */
  apiOrigin: string;
  /** The `spikeOrigin` route parameter, or null when the address has none. */
  spikeOrigin: string | null;
};

/** SCR-dev-spikes: the map spike (D-100 row 6). */
export function MapSpikeScreen({ apiOrigin, spikeOrigin }: MapSpikeScreenProps): JSX.Element {
  const theme = useTheme();
  return (
    <View testID="dev.map-spike" style={[styles.ground, { backgroundColor: theme.color.bg }]}>
      <Text role="caption" tone="secondary">
        Spike server: {spikeServerOrigin(apiOrigin, spikeOrigin)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1, padding: gutter.regular },
});
