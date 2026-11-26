import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Progress } from '@/ui/components/progress';
import { Text } from '@/ui/components/text';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { size, space } from '@/ui/tokens';

import { AUTH_NAMESPACES } from './auth-translation';

/** Sign-up has five steps, and the account is the first. */
const TOTAL = 5;
const STEP = 1;

const ROW: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x3,
  width: '100%',
  alignSelf: 'center',
};
const BAR: ViewStyle = { flex: 1 };

/**
 * Where a new person is in sign-up while they make their account: the first of five bars, then the
 * count. It stands in the app bar's center, as the bar of the steps after it does, and in a wide
 * window it is no wider than the column under it.
 */
export function SignUpStepBar(): JSX.Element {
  const { t } = useTranslation(AUTH_NAMESPACES);
  const layout = useBreakpoint();
  return (
    <View style={[ROW, { maxWidth: size.feedColumn - 2 * layout.gutter }]}>
      <View style={BAR}>
        <Progress
          kind="steps"
          total={TOTAL}
          done={STEP}
          label={t('onboarding:progress.label', { step: STEP, total: TOTAL })}
        />
      </View>
      {/* The bar's name says the same. */}
      <Text role="mono" tone="secondary" hidden={true}>
        {t('onboarding:progress.count', { step: STEP, total: TOTAL })}
      </Text>
    </View>
  );
}
