import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Button } from '@/ui/components/button';
import { PersonRow } from '@/ui/components/person-row';
import { SectionHeader } from '@/ui/components/section-header';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

import type { OfficeBlockProps } from './office-sheets';
import { presentRunning } from './present-office';

const NONE: ViewStyle = { paddingVertical: space.x3 };
const SHOW_ALL: ViewStyle = { alignItems: 'flex-start', marginTop: space.x2 };

/** Block 15: the people who filed for the office, counted in the section's head. */
export function OfficeRunning({ data, t, ctx }: OfficeBlockProps): JSX.Element {
  const running = presentRunning(data.candidates, t, ctx);
  return (
    <View>
      <SectionHeader
        label={t('office:section.running')}
        trailing={
          <Text role="mono" tone="secondary">
            {running.count}
          </Text>
        }
      />
      {running.none === null ? (
        running.rows.map((row) => <PersonRow key={row.testID} {...row} />)
      ) : (
        <View style={NONE}>
          <Text role="body">{running.none}</Text>
        </View>
      )}
      {running.showAll === null ? null : (
        <View style={SHOW_ALL}>
          <Button variant="quiet" {...running.showAll} />
        </View>
      )}
    </View>
  );
}
