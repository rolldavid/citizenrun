import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { MiniMapStill } from '@/ui/components/mini-map-still';
import { SectionHeader } from '@/ui/components/section-header';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

import type { OfficeBlockProps } from './office-sheets';
import { presentWhere } from './present-office';

const MEMBERS: ViewStyle = { marginTop: space.x2 };

/** Block 4: the district as a small still of its outline, with its name and its level. */
export function OfficeWhere({ data, t }: Pick<OfficeBlockProps, 'data' | 't'>): JSX.Element {
  const where = presentWhere(data.office, data.mapRow, t);
  return (
    <View>
      <SectionHeader label={t('office:section.where')} />
      <MiniMapStill {...where.map} />
      {where.membersLine === null ? null : (
        <View style={MEMBERS}>
          <Text role="caption" tone="secondary">
            {where.membersLine}
          </Text>
        </View>
      )}
    </View>
  );
}
