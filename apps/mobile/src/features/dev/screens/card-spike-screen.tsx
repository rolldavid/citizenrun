import type { JSX } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/ui/theme';

/** SCR-dev-spikes: the card renderer's smoke screen (D-100 row 7). */
export function CardSpikeScreen(): JSX.Element {
  const theme = useTheme();
  return (
    <View testID="dev.card-spike" style={[styles.ground, { backgroundColor: theme.color.bg }]} />
  );
}

const styles = StyleSheet.create({
  ground: { flex: 1 },
});
