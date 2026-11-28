import type { CardContext } from '@citizenrun/cards';
import type { ElectionView, TFunction } from '@citizenrun/shared';
import type { JSX } from 'react';
import { ScrollView, View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { FactRow } from '@/ui/components/fact-row';
import { SectionHeader } from '@/ui/components/section-header';
import { Sheet } from '@/ui/components/sheet';
import { SourceLink } from '@/ui/components/source-link';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

import { OFFICE_TEST_IDS } from './office-test-ids';
import { presentTracks } from './present-office';
import type { OfficePageActions } from './present-office';
import { useSheetScroll } from './sheet-scroll';

export type TracksSheetProps = {
  open: boolean;
  onClose: () => void;
  /** The next election; null draws the sentence that says the steps are not known. */
  election: ElectionView | null;
  t: TFunction;
  ctx: CardContext;
  onOpenSources: OfficePageActions['openSources'];
};

const DETENTS = ['content', 'full'] as const;
const TRACK: ViewStyle = { marginTop: space.x4 };
const NONE: ViewStyle = { paddingVertical: space.x3 };
const CAUTION: ViewStyle = { marginTop: space.x6 };

/**
 * The filing steps: each way onto the ballot with its dates, what it asks and its own source.
 * It ends with the caution line. A source row opens the sources sheet in this one's place.
 */
export function TracksSheet({
  open,
  onClose,
  election,
  t,
  ctx,
  onOpenSources,
}: TracksSheetProps): JSX.Element {
  const scroller = useSheetScroll();
  const steps = presentTracks(election, t, ctx, { openSources: onOpenSources });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('office:filing.stepsTitle')}
      detents={DETENTS}
      testID={OFFICE_TEST_IDS.stepsSheet}
    >
      <ScrollView style={scroller}>
        {steps.none === null ? null : (
          <View style={NONE}>
            <Text role="body">{steps.none}</Text>
          </View>
        )}
        {steps.tracks.map((track, index) => (
          <View key={track.key} style={index === 0 ? null : TRACK}>
            <SectionHeader label={track.name} level={3} />
            {track.rows.map(({ key, ...row }) => (
              <FactRow key={key} {...row} />
            ))}
            <SourceLink {...track.source} />
          </View>
        ))}
        <View style={CAUTION}>
          <Text role="label">{steps.caution}</Text>
        </View>
      </ScrollView>
    </Sheet>
  );
}
