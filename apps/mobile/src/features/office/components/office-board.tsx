import type { JSX } from 'react';
import { View } from 'react-native';

import { FactRow } from '@/ui/components/fact-row';
import { SectionHeader } from '@/ui/components/section-header';

import type { OfficeBlockProps } from './office-sheets';
import { presentBoard } from './present-office';

/**
 * Block 11: how many of the board's seats are up, how many make a majority and how its members
 * split. Nothing for an office that is not a board.
 */
export function OfficeBoard({ data, t }: Pick<OfficeBlockProps, 'data' | 't'>): JSX.Element | null {
  const rows = presentBoard(data.office, t);
  if (rows === null) {
    return null;
  }
  return (
    <View>
      <SectionHeader label={t('office:section.board')} />
      {rows.map(({ key, ...row }) => (
        <FactRow key={key} {...row} />
      ))}
    </View>
  );
}
