import { useRef } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { TextInstance, ViewStyle } from 'react-native';

import { AUTH_NAMESPACES } from '@/features/auth/components/auth-translation';
import { LegalLine } from '@/features/auth/components/legal-line';
import { useTight } from '@/features/auth/components/use-tight';
import { useWelcomeViewModel } from '@/features/auth/view-models/use-welcome-view-model';
import type { WelcomeViewModel } from '@/features/auth/view-models/welcome.types';
import { head } from '@/platform/head';
import { EmptyChair } from '@/ui/components/empty-chair';
import { Screen } from '@/ui/components/screen';
import { StickyFooter } from '@/ui/components/sticky-footer';
import { Text } from '@/ui/components/text';
import { Wordmark } from '@/ui/components/wordmark';
import { useFocusOnMount } from '@/ui/focus';
import { size, space } from '@/ui/tokens';

// Flush left at the gutter, from the top down.
const CONTENT: ViewStyle = {
  alignItems: 'flex-start',
  paddingTop: space.x6,
  paddingBottom: space.x6,
};
const CHAIR: ViewStyle = { marginTop: space.x8 };
const TITLE: ViewStyle = { marginTop: space.x6 };
const BODY: ViewStyle = { marginTop: space.x2 };
const LEGAL: ViewStyle = { marginTop: space.x6 };
// As wide as the column, and in the middle of a wider window with it.
const FOOTER: ViewStyle = { width: '100%', maxWidth: size.feedColumn, alignSelf: 'center' };

/**
 * SCR-welcome: the first screen for someone with no session. It holds no one's content, so the
 * empty chair stands on it: the name, the chair, one sentence, one line and one way on.
 */
export function WelcomeScreenView({ vm }: { vm: WelcomeViewModel }): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const tight = useTight();
  const titleRef = useRef<TextInstance>(null);
  // A screen reader announces the screen by its heading.
  useFocusOnMount(titleRef);

  return (
    <Screen
      width="column"
      appBar={null}
      footer={
        <View style={FOOTER}>
          <StickyFooter
            primary={{
              label: t('auth:welcome.start'),
              href: vm.startHref,
              testID: 'auth.welcome-start',
            }}
          />
        </View>
      }
      testID="auth.welcome"
    >
      <View style={CONTENT}>
        <Wordmark variant="wordmark" capHeight={size.wordmarkCap.splash} />
        {/* On a tight layout the drawing gives its room to the words (PC6B-14). */}
        {tight ? null : (
          <View style={CHAIR}>
            <EmptyChair />
          </View>
        )}
        <View style={TITLE}>
          <Text ref={titleRef} role={tight ? 'title' : 'display'} heading={1}>
            {t('auth:welcome.title')}
          </Text>
        </View>
        <View style={BODY}>
          <Text role="body" tone="secondary">
            {t('auth:welcome.body')}
          </Text>
        </View>
        <View style={LEGAL}>
          <LegalLine
            i18nKey="auth:welcome.legal"
            links={vm.links}
            testIDs={{ terms: 'auth.welcome-terms', privacy: 'auth.welcome-privacy' }}
          />
        </View>
      </View>
    </Screen>
  );
}

export function WelcomeScreen({ next }: { next: string | null }): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const vm = useWelcomeViewModel({ next });
  return (
    <>
      <head.Title>
        {t('common:documentTitle', { title: t('auth:welcome.documentTitle') })}
      </head.Title>
      <WelcomeScreenView vm={vm} />
    </>
  );
}
