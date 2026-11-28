import type { CardContext } from '@citizenrun/cards';
import type { TFunction } from '@citizenrun/shared';
import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { OfficeReadyData } from '@/features/office/view-models/office.types';
import { ActionRow } from '@/ui/components/action-row';
import { Meter } from '@/ui/components/meter';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

import { OFFICE_TEST_IDS } from './office-test-ids';
import { presentActionCard, presentActions } from './present-office';

export type OfficeActionCardProps = { data: OfficeReadyData; t: TFunction; ctx: CardContext };

const CARD: ViewStyle = { gap: space.x4 };
// The day count stands on the baseline of the line that names its date.
const DAYS: ViewStyle = { flexDirection: 'row', alignItems: 'baseline', gap: space.x3 };
const LINE: ViewStyle = { flex: 1 };
const METERS: ViewStyle = { gap: space.x3 };

/** The meters open nothing here: the section they would scroll to is not on this page yet. */
function opensNothing(): void {}

/**
 * The action card of the wide layout, in the right column: the actions stacked, the days left
 * beside the date they are counted to, and the two meters. It has no frame of its own.
 */
export function OfficeActionCard({ data, t, ctx }: OfficeActionCardProps): JSX.Element {
  const { office } = data;
  const card = presentActionCard(office, t, ctx);
  return (
    <View style={CARD} testID={OFFICE_TEST_IDS.actionCard}>
      <ActionRow {...presentActions(office, data.actions, t)} layout="stacked" />
      {card.days === null ? (
        <Text role="caption">{card.closingLine}</Text>
      ) : (
        // The count follows the clock: the wrapper is what a journey's screenshot masks.
        <View style={DAYS} testID={OFFICE_TEST_IDS.actionCardDaysLive}>
          <Text role="numeralTitle" accessibilityLabel={card.days.label}>
            {card.days.figure}
          </Text>
          <View style={LINE}>
            <Text role="caption">{card.closingLine}</Text>
          </View>
        </View>
      )}
      <View style={METERS}>
        <Meter form="page" {...card.ease} onPress={opensNothing} />
        <Meter form="page" {...card.impact} onPress={opensNothing} />
      </View>
    </View>
  );
}
