import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { BigNumber } from '@/ui/components/big-number';
import { FactRow } from '@/ui/components/fact-row';
import { SectionHeader } from '@/ui/components/section-header';
import { SourceLink } from '@/ui/components/source-link';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

import { useOfficeSheets } from './office-sheets';
import type { OfficeBlockProps } from './office-sheets';
import { presentPay } from './present-office';

const FIGURE: ViewStyle = { paddingTop: space.x2, paddingBottom: space.x4 };

/**
 * Block 5: the pay stated large once, then what the office asks and gives as rows, then the
 * sources the section stands on.
 */
export function OfficePay({ data, t, ctx }: OfficeBlockProps): JSX.Element {
  const page = useOfficeSheets();
  const pay = presentPay(data.office, t, ctx, page);
  return (
    <View>
      <SectionHeader label={t('office:section.pay')} />
      <View style={FIGURE}>
        {pay.figure.kind === 'unpaid' ? (
          <Text role="title" testID={pay.figure.testID}>
            {pay.figure.text}
          </Text>
        ) : (
          <BigNumber {...pay.figure.number} />
        )}
      </View>
      {pay.rows.map(({ key, ...row }) => (
        <FactRow key={key} {...row} />
      ))}
      {pay.sources.map((source) => (
        <SourceLink key={source.testID} {...source} />
      ))}
    </View>
  );
}
