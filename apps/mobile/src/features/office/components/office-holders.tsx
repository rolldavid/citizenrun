import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { PersonRow } from '@/ui/components/person-row';
import { SectionHeader } from '@/ui/components/section-header';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

import type { OfficeBlockProps } from './office-sheets';
import { presentHolders } from './present-office';

const NONE: ViewStyle = { paddingVertical: space.x3 };

/** Block 10: who holds the office now, every person drawn the same way. */
export function OfficeHolders({ data, t, ctx }: OfficeBlockProps): JSX.Element {
  const holders = presentHolders(data.office, data.officeholders, t, ctx);
  return (
    <View>
      <SectionHeader label={t('office:section.holders')} />
      {holders.none === null ? (
        holders.rows.map((row) => <PersonRow key={row.testID} {...row} />)
      ) : (
        <View style={NONE}>
          <Text role="body">{holders.none}</Text>
        </View>
      )}
    </View>
  );
}
