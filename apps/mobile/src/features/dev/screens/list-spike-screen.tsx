import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/ui/theme';

/** SCR-dev-spikes: the list spike (D-100 row 8). */
export function ListSpikeScreen(): JSX.Element {
  const theme = useTheme();
  return (
    <View testID="dev.list-spike" style={[styles.ground, { backgroundColor: theme.color.bg }]} />
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1 },
});
