import type { JSX } from 'react';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Notice } from '@/ui/components/notice';
import { StickyFooter } from '@/ui/components/sticky-footer';
import type { StickyFooterProps } from '@/ui/components/sticky-footer';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { size, space } from '@/ui/tokens';

/** A refusal said above the footer, with one way out at most. */
export type StepNotice = {
  text: string;
  action?: { label: string; onPress: () => void; testID: string };
};

export type StepFooterProps = {
  notice: StepNotice | null;
  footer: StickyFooterProps;
};

// As wide as the step's column, and in the middle of a wider window with it.
const COLUMN: ViewStyle = { width: '100%', maxWidth: size.feedColumn, alignSelf: 'center' };
const NOTICE: ViewStyle = { paddingBottom: space.x3 };

/** The foot of a sign-up step: what was refused, then the bar with the step's one button. */
export function StepFooter({ notice, footer }: StepFooterProps): JSX.Element {
  const layout = useBreakpoint();
  return (
    <View style={COLUMN}>
      {notice === null ? null : (
        <View style={[NOTICE, { paddingHorizontal: layout.gutter }]}>
          <Notice
            kind="error"
            text={notice.text}
            {...(notice.action === undefined ? {} : { action: notice.action })}
          />
        </View>
      )}
      <StickyFooter {...footer} />
    </View>
  );
}
