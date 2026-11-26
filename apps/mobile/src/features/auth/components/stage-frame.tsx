import { useRef } from 'react';
import type { JSX, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { TextInstance, ViewStyle } from 'react-native';

import { Screen } from '@/ui/components/screen';
import { StickyFooter } from '@/ui/components/sticky-footer';
import type { StickyFooterProps } from '@/ui/components/sticky-footer';
import { Text } from '@/ui/components/text';
import { useFocusOnMount } from '@/ui/focus';
import { size, space } from '@/ui/tokens';

import { AUTH_NAMESPACES } from './auth-translation';
import { SignUpStepBar } from './sign-up-step-bar';
import { useTight } from './use-tight';

/** The buttons of a stage: always the ink one, and at most one more beside it. */
export type StageFooter = StickyFooterProps & {
  primary: NonNullable<StickyFooterProps['primary']>;
};

export type StageFrameProps = {
  onBack: () => void;
  /** A new person is making an account: the step bar shows the first of five steps. */
  signingUp: boolean;
  /** The device has no connection: the offline line shows and the stage's button waits. */
  offline: boolean;
  /** The heading. */
  title: string;
  /** The one line under the heading, where the stage has one. */
  body?: string;
  /** Absent where the stage's choices stand in its content. */
  footer?: StageFooter;
  /** True where the stage's own field takes the focus as it opens, in place of the heading. */
  fieldTakesFocus?: boolean;
  testID: string;
  /** The stage's one control. */
  children: ReactNode;
};

const CONTENT: ViewStyle = { paddingTop: space.x4, paddingBottom: space.x6 };
const BODY: ViewStyle = { marginTop: space.x2 };
const CONTROL: ViewStyle = { marginTop: space.x6 };
// As wide as the stage's column, and in the middle of a wider window with it.
const COLUMN: ViewStyle = { width: '100%', maxWidth: size.feedColumn, alignSelf: 'center' };

type StageTitleProps = { title: string; role: 'title' | 'display' };

/** The heading of a stage that takes the focus as it opens, so a screen reader announces the stage. */
function AnnouncedTitle({ title, role }: StageTitleProps): JSX.Element {
  const titleRef = useRef<TextInstance>(null);
  useFocusOnMount(titleRef);
  return (
    <Text ref={titleRef} role={role} heading={1}>
      {title}
    </Text>
  );
}

/**
 * The frame every stage of sign-in is drawn in: back, the step bar while an account is being made,
 * one heading, one line, one control, and a footer with the stage's button. Without a connection
 * the button says so and takes no press, and a second button is not offered.
 */
export function StageFrame({
  onBack,
  signingUp,
  offline,
  title,
  body,
  footer,
  fieldTakesFocus = false,
  testID,
  children,
}: StageFrameProps): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const titleRole = useTight() ? 'title' : 'display';

  const shownFooter: StickyFooterProps | null =
    footer === undefined
      ? null
      : offline
        ? {
            primary: {
              label: t('common:states.offlineAction'),
              disabled: true,
              testID: footer.primary.testID,
            },
          }
        : footer;

  return (
    <Screen
      width="column"
      appBar={{
        variant: 'screen',
        title: null,
        onBack,
        ...(signingUp ? { center: <SignUpStepBar /> } : {}),
      }}
      offline={offline}
      footer={
        shownFooter === null ? undefined : (
          <View style={COLUMN}>
            <StickyFooter {...shownFooter} />
          </View>
        )
      }
      testID={testID}
    >
      <View style={CONTENT}>
        {fieldTakesFocus ? (
          <Text role={titleRole} heading={1}>
            {title}
          </Text>
        ) : (
          <AnnouncedTitle title={title} role={titleRole} />
        )}
        {body === undefined ? null : (
          <View style={BODY}>
            <Text role="body" tone="secondary">
              {body}
            </Text>
          </View>
        )}
        <View style={CONTROL}>{children}</View>
      </View>
    </Screen>
  );
}
