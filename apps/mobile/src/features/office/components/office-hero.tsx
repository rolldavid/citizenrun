import { CANVAS, OfficeHeroCanvas, canvasColorsFrom } from '@citizenrun/cards';
import type { CardContext } from '@citizenrun/cards';
import type { OfficeDetail, TFunction } from '@citizenrun/shared';
import { memo, useMemo, useState } from 'react';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Skeleton } from '@/ui/components/skeleton';
import { useFontsReady } from '@/ui/fonts';
import type { Layout } from '@/ui/shells/use-breakpoint';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { useTheme } from '@/ui/theme';
import { issue, size } from '@/ui/tokens';

import { OFFICE_TEST_IDS } from './office-test-ids';
import { presentHero } from './present-office';

export type OfficeHeroProps = { office: OfficeDetail; t: TFunction; ctx: CardContext };

const STRIP: ViewStyle = { alignSelf: 'stretch' };

/**
 * The hero's width before it is measured: the safe width of a phone, where the strip is full
 * bleed, and the content column's width beside the rail.
 */
export function heroWidthFor(layout: Layout): number {
  return layout.breakpoint === 'compact'
    ? layout.mainWidth
    : Math.max(0, Math.min(size.officeContent, layout.mainWidth - layout.gutter * 2));
}

/** The least height of a hero as wide as `width`: the shape its skeleton takes. */
export function heroHeightFor(width: number): number {
  return Math.round((width * CANVAS.heroMinHeight) / CANVAS.width);
}

/**
 * CARD-office-hero: the top of the office's canvas, drawn at the width it measures. Until that
 * width and the four faces are there it is a block of the hero's least height, because a canvas is
 * never drawn in a fallback face. One image to a screen reader, named by the sentence that stands
 * for it.
 */
function Hero({ office, t, ctx }: OfficeHeroProps): JSX.Element {
  const theme = useTheme();
  const layout = useBreakpoint();
  const fontsReady = useFontsReady();
  const [measured, setMeasured] = useState<number | null>(null);
  const colors = useMemo(() => canvasColorsFrom(theme.name, theme.color, issue), [theme]);
  const hero = useMemo(() => presentHero(office, t, ctx, colors), [office, t, ctx, colors]);

  const drawn = measured !== null && measured > 0 && fontsReady;
  return (
    <View
      testID={OFFICE_TEST_IDS.hero}
      style={STRIP}
      onLayout={(event) => {
        setMeasured(event.nativeEvent.layout.width);
      }}
      {...(drawn
        ? { accessible: true, accessibilityRole: 'image', accessibilityLabel: hero.altText }
        : {})}
    >
      {drawn ? (
        <OfficeHeroCanvas model={hero.model} colors={hero.colors} width={measured} />
      ) : (
        // A canvas is never drawn in a fallback face: its lines were placed for the four faces.
        <Skeleton shape="block" height={heroHeightFor(measured ?? heroWidthFor(layout))} />
      )}
    </View>
  );
}

/** Drawn again only for another office, another version of it or another language (D-178). */
export const OfficeHero = memo(
  Hero,
  (before, after) =>
    before.office.id === after.office.id &&
    before.office.changedAt === after.office.changedAt &&
    before.t === after.t &&
    before.ctx.locale === after.ctx.locale,
);
