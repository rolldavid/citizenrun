import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { DealLine } from '@/ui/components/deal-line';
import { IssueChip } from '@/ui/components/issue-chip';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

import { useOfficeSheets } from './office-sheets';
import type { OfficeBlockProps } from './office-sheets';
import { OFFICE_TEST_IDS } from './office-test-ids';
import { presentDeal, presentIssueChips } from './present-office';

const LINE: ViewStyle = { marginTop: space.x2 };
const CHIPS: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: space.x2,
  marginTop: space.x4,
};

/**
 * Block 3: the deal in whole sentences under its label, which has no rule above it, then the
 * issues the office moves as small chips.
 */
export function OfficeDeal({ data, t, ctx }: OfficeBlockProps): JSX.Element {
  const page = useOfficeSheets();
  const parts = presentDeal(data.office, t, ctx, page);
  const chips = presentIssueChips(data.office, data.issues, data.singleIssue, t);
  return (
    <View>
      <Text role="monoLabel" heading={2}>
        {t('office:section.deal')}
      </Text>
      <View style={LINE}>
        <DealLine parts={parts} testID={OFFICE_TEST_IDS.dealLine} />
      </View>
      {chips.length === 0 ? null : (
        <View style={CHIPS}>
          {chips.map((chip) => (
            <IssueChip key={chip.issueId} {...chip} />
          ))}
        </View>
      )}
    </View>
  );
}
