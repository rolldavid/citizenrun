import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { goBack } from '@/lib/navigation';
import { Screen } from '@/ui/components/screen';
import { Skeleton } from '@/ui/components/skeleton';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { size, space } from '@/ui/tokens';

import { heroHeightFor, heroWidthFor } from './office-hero';
import { OFFICE_TEST_IDS } from './office-test-ids';

/** The page's text lines while it loads. */
const LOADING_LINES = 6;

/** The action card's height as a share of its width: its stacked actions, its date and its meters. */
const ACTION_CARD_SHARE = 0.75;

const LINES: ViewStyle = { paddingVertical: space.x6 };
const BAR: ViewStyle = { paddingVertical: space.x2 };

/** Out of a screen reader's way: every block after the first, which says nothing new. */
const QUIET = {
  'aria-hidden': true,
  accessibilityElementsHidden: true,
  importantForAccessibility: 'no-hide-descendants',
} as const;

/**
 * The office page while it loads: its frame, and blocks in the shape of the hero, the text and
 * the actions. The actions are a bar under the page on a phone and a card beside it when wide.
 */
export function OfficeLoading(): JSX.Element {
  const layout = useBreakpoint();
  const compact = layout.breakpoint === 'compact';
  const actions = layout.showsRightColumn ? (
    <View {...QUIET}>
      <Skeleton shape="block" height={Math.round(size.actionCard * ACTION_CARD_SHARE)} />
    </View>
  ) : (
    <View {...QUIET} style={[BAR, { paddingHorizontal: layout.gutter }]}>
      <Skeleton shape="block" height={size.actionRow} />
    </View>
  );
  return (
    <Screen
      width="page"
      appBar={{
        variant: 'screen',
        title: null,
        onBack: () => {
          goBack('/');
        },
      }}
      {...(layout.showsRightColumn ? { aside: actions } : { footer: actions })}
      testID={OFFICE_TEST_IDS.loading}
    >
      {/* The hero is full bleed on a phone, so its block leaves the gutters as the hero does. */}
      <View style={compact ? { marginHorizontal: -layout.gutter } : null}>
        <Skeleton shape="block" height={heroHeightFor(heroWidthFor(layout))} />
      </View>
      <View {...QUIET} style={LINES}>
        <Skeleton shape="line" lines={LOADING_LINES} />
      </View>
    </Screen>
  );
}
