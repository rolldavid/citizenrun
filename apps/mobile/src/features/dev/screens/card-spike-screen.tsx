import { HelloCard, canvasColorsFrom } from '@citizenrun/cards';
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { head } from '@/platform/head';
import { Button } from '@/ui/components/button';
import { Screen } from '@/ui/components/screen';
import { Skeleton } from '@/ui/components/skeleton';
import { Text } from '@/ui/components/text';
import { useFontsReady } from '@/ui/fonts';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { ThemeProvider, useTheme } from '@/ui/theme';
import type { ThemeChoice } from '@/ui/theme';
import { issue, space } from '@/ui/tokens';

import { HELLO_PHOTO_DATA_URI } from './hello-photo';
import { SpikeGround } from './spike-ground';

const NEXT_THEME: Readonly<Record<ThemeChoice, ThemeChoice>> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
};

/** What a screen reader says in place of the canvas, which hides itself (D-277). */
const CARD_LABEL =
  'Hello card: four faces, tracked and tilted text, a hand-broken paragraph, the treasurer drawing, a photo, a gradient and a clipped photo';

// The header is text on the page ground and nothing else, so the card is the first block of its own
// ground from the top of the screen.
const HEADER: ViewStyle = { paddingVertical: space.x4 };
const UNDER: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  justifyContent: 'space-between',
  columnGap: space.x4,
  rowGap: space.x3,
  maxWidth: '100%',
  paddingTop: space.x4,
  paddingBottom: space.x6,
};

/**
 * The card, its caption and the theme button. Drawn inside the frame, so the layout it reads is the
 * frame's: a full-bleed card stops at a side inset.
 */
function CardSpikeBody({
  choice,
  onCycleTheme,
}: {
  choice: ThemeChoice;
  onCycleTheme: () => void;
}): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const fontsReady = useFontsReady();
  const colors = useMemo(() => canvasColorsFrom(theme.name, theme.color, issue), [theme]);
  const width = layout.canvasWidth;
  const compact = layout.breakpoint === 'compact';

  // At compact the card is as wide as the safe area, like every feed canvas, so it leaves the
  // frame's gutters; wider, it stands at the gutter's left edge and the line under it ends where it
  // ends.
  const bleed: ViewStyle = compact ? { marginHorizontal: -layout.gutter } : {};
  const cardBox: ViewStyle = { width, alignSelf: 'flex-start' };
  const under: ViewStyle = compact ? {} : { width };

  return (
    <>
      <View style={HEADER}>
        <Text role="heading" heading={1}>
          Card spike
        </Text>
      </View>
      <View style={bleed}>
        {fontsReady ? (
          <View
            testID="dev.card-spike-card"
            accessible={true}
            accessibilityRole="image"
            accessibilityLabel={CARD_LABEL}
            style={cardBox}
          >
            <HelloCard colors={colors} photoHref={HELLO_PHOTO_DATA_URI} width={width} />
          </View>
        ) : (
          // A canvas is never drawn in a fallback face: its lines were placed for the four faces.
          <View style={cardBox}>
            <Skeleton shape="canvas" />
          </View>
        )}
      </View>
      <View style={[UNDER, under]}>
        <Text role="caption" tone="secondary" testID="dev.card-spike-caption">
          {`HelloCard, ${width.toFixed(1)} points wide, ${theme.name} theme`}
        </Text>
        <Button
          variant="secondary"
          size="sm"
          label={`Theme: ${choice}`}
          onPress={onCycleTheme}
          testID="dev.card-spike-theme"
        />
      </View>
    </>
  );
}

/** SCR-dev-spikes: the card renderer's smoke screen (D-100 row 7). Nothing on it moves. */
export function CardSpikeScreen(): JSX.Element {
  const outer = useTheme();
  // The spike's own theme choice: the innermost provider wins.
  const [choice, setChoice] = useState<ThemeChoice>('system');
  return (
    <ThemeProvider choice={choice} textScale={outer.textScale}>
      <SpikeGround />
      <Screen width="full" scroll={true} appBar={null} testID="dev.card-spike">
        <head.Title>Card spike</head.Title>
        <CardSpikeBody
          choice={choice}
          onCycleTheme={() => {
            setChoice((current) => NEXT_THEME[current]);
          }}
        />
      </Screen>
    </ThemeProvider>
  );
}
