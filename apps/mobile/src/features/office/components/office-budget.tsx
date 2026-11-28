import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { BigNumber } from '@/ui/components/big-number';
import { SectionHeader } from '@/ui/components/section-header';
import { SourceLink } from '@/ui/components/source-link';
import { space } from '@/ui/tokens';

import { useOfficeSheets } from './office-sheets';
import type { OfficeBlockProps } from './office-sheets';
import { presentBudget } from './present-office';

const FIGURE: ViewStyle = { paddingTop: space.x2, paddingBottom: space.x3 };

/** Block 7: the money the office answers for, with the year it is of and its source. */
export function OfficeBudget({ data, t, ctx }: OfficeBlockProps): JSX.Element {
  const page = useOfficeSheets();
  const budget = presentBudget(data.office, t, ctx, page);
  return (
    <View>
      <SectionHeader label={t('office:section.budget')} />
      <View style={FIGURE}>
        <BigNumber {...budget.number} />
      </View>
      {budget.sources.map((source) => (
        <SourceLink key={source.testID} {...source} />
      ))}
    </View>
  );
}
