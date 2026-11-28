import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Button } from '@/ui/components/button';
import { DeadlineBlock } from '@/ui/components/deadline-block';
import { FactRow } from '@/ui/components/fact-row';
import { SectionHeader } from '@/ui/components/section-header';
import { SourceLink } from '@/ui/components/source-link';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

import { useOfficeSheets } from './office-sheets';
import type { OfficeBlockProps } from './office-sheets';
import { OFFICE_TEST_IDS } from './office-test-ids';
import { presentFiling } from './present-office';

const PARTY_SEAT: ViewStyle = { gap: space.x2, paddingTop: space.x2, paddingBottom: space.x3 };
const ABOVE_DEADLINE: ViewStyle = { paddingTop: space.x2 };
const DEADLINE: ViewStyle = { paddingTop: space.x3, paddingBottom: space.x4 };
const STEPS: ViewStyle = { marginTop: space.x4 };

/**
 * Block 12: the deadline with its date, its confidence, its source and the caution, said once;
 * then what filing asks, and the way to the steps. A party seat filled at a caucus or a meeting
 * has the sentence that says so in the deadline's place.
 */
export function OfficeFiling({ data, t, ctx }: OfficeBlockProps): JSX.Element {
  const page = useOfficeSheets();
  const filing = presentFiling(data.office, t, ctx, page);
  const { partySeat, primaryBallotLine, deadline, steps } = filing;
  return (
    <View>
      <SectionHeader label={t('office:section.filing')} />
      {partySeat === null ? null : (
        <View style={PARTY_SEAT}>
          <Text role="body">{partySeat.sentence}</Text>
          {partySeat.quote === null ? null : (
            <Text role="caption" tone="secondary" selectable={true}>
              {partySeat.quote}
            </Text>
          )}
          {partySeat.source === null ? null : <SourceLink {...partySeat.source} />}
        </View>
      )}
      {primaryBallotLine === null ? null : (
        <View style={ABOVE_DEADLINE}>
          <Text role="caption" tone="secondary">
            {primaryBallotLine}
          </Text>
        </View>
      )}
      {deadline === null ? null : (
        // Its headline, ring and flag count days: the wrapper is what a journey's screenshot masks.
        <View style={DEADLINE} testID={OFFICE_TEST_IDS.deadlineLive}>
          <DeadlineBlock {...deadline} />
        </View>
      )}
      {filing.rows.map(({ key, ...row }) => (
        <FactRow key={key} {...row} />
      ))}
      {filing.sources.map((source) => (
        <SourceLink key={source.testID} {...source} />
      ))}
      {steps === null ? null : (
        <View style={STEPS}>
          <Button
            variant="secondary"
            label={steps.label}
            trailingIcon="chevronRight"
            fullWidth={true}
            onPress={steps.onPress}
            testID={steps.testID}
          />
        </View>
      )}
    </View>
  );
}
