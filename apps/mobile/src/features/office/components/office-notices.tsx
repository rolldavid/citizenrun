import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Notice } from '@/ui/components/notice';
import { space } from '@/ui/tokens';

import type { OfficeBlockProps } from './office-sheets';
import { presentNotices } from './present-office';

const STACK: ViewStyle = { gap: space.x3, paddingTop: space.x4 };

/** Block 2: the notices that stand under the hero. Nothing, and no room, where none holds. */
export function OfficeNotices({
  data,
  t,
}: Pick<OfficeBlockProps, 'data' | 't'>): JSX.Element | null {
  const notices = presentNotices(data.office, t, data.onOpenSource);
  if (notices.length === 0) {
    return null;
  }
  return (
    <View style={STACK}>
      {notices.map(({ key, ...notice }) => (
        <Notice key={key} {...notice} />
      ))}
    </View>
  );
}
