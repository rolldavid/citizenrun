import { useRef } from 'react';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { TextInstance, ViewStyle } from 'react-native';

import { Screen } from '@/ui/components/screen';
import type { StickyFooterProps } from '@/ui/components/sticky-footer';
import { Text } from '@/ui/components/text';
import { useFocusOnMount } from '@/ui/focus';
import { space } from '@/ui/tokens';

import { StepBar } from './step-bar';
import { StepFooter } from './step-footer';
import type { StepNotice } from './step-footer';
import { useTight } from './use-tight';

export type StepFrameProps = {
  step: 2 | 3 | 4 | 5;
  /** Null on the photo step: there is nothing to go back to. */
  onBack: (() => void) | null;
  /** The heading. */
  title: string;
  /** The one helper line. */
  helper: string;
  /** The device has no connection: the offline line shows and the step's button waits. */
  offline: boolean;
  /** A refusal, said above the footer. */
  notice: StepNotice | null;
  footer: StickyFooterProps;
  testID: string;
  /** The step's one control. */
  children: ReactNode;
};

const CONTENT: ViewStyle = { paddingTop: space.x4, paddingBottom: space.x6 };
const HELPER: ViewStyle = { marginTop: space.x2 };
const CONTROL: ViewStyle = { marginTop: space.x6 };

/**
 * The frame the sign-up steps share: the step bar, one heading, one helper line, one control and a
 * footer with one button. Without a connection the button says so and takes no press.
 */
export function StepFrame({
  step,
  onBack,
  title,
  helper,
  offline,
  notice,
  footer,
  testID,
  children,
}: StepFrameProps): JSX.Element {
  const { t } = useTranslation(['common']);
  const tight = useTight();
  const titleRef = useRef<TextInstance>(null);
  // A screen reader announces the step by its heading.
  useFocusOnMount(titleRef);

  const { primary, ...rest } = footer;
  const shownFooter: StickyFooterProps =
    primary === undefined
      ? rest
      : offline
        ? {
            ...rest,
            primary: {
              label: t('common:states.offlineAction'),
              disabled: true,
              testID: primary.testID,
            },
          }
        : footer;

  return (
    <Screen
      width="column"
      appBar={{ variant: 'screen', title: null, onBack, center: <StepBar step={step} /> }}
      offline={offline}
      footer={<StepFooter notice={notice} footer={shownFooter} />}
      testID={testID}
    >
      <View style={CONTENT}>
        <Text ref={titleRef} role={tight ? 'title' : 'display'} heading={1}>
          {title}
        </Text>
        <View style={HELPER}>
          <Text role="body" tone="secondary">
            {helper}
          </Text>
        </View>
        <View style={CONTROL}>{children}</View>
      </View>
    </Screen>
  );
}
