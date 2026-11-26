import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Progress } from '@/ui/components/progress';
import { Text } from '@/ui/components/text';
import { useBreakpoint } from '@/ui/shells/use-breakpoint';
import { size, space } from '@/ui/tokens';

export type StepBarProps = {
  /** Photo is step 2, handle 3, issues 4, location 5; step 1 is the account. */
  step: 2 | 3 | 4 | 5;
};

/** Sign-up has five steps. */
const TOTAL = 5;

const ROW: ViewStyle = {
  flexDirection: 'row',
  alignItems: 'center',
  gap: space.x3,
  width: '100%',
  alignSelf: 'center',
};
const BAR: ViewStyle = { flex: 1 };

/**
 * Where a person is in sign-up: one bar per step, then the count. It stands in the app bar's center,
 * and in a wide window it is no wider than the step's column under it.
 */
export function StepBar({ step }: StepBarProps): JSX.Element {
  const { t } = useTranslation(['onboarding']);
  const layout = useBreakpoint();
  return (
    <View style={[ROW, { maxWidth: size.feedColumn - 2 * layout.gutter }]}>
      <View style={BAR}>
        <Progress
          kind="steps"
          total={TOTAL}
          done={step}
          label={t('onboarding:progress.label', { step, total: TOTAL })}
        />
      </View>
      {/* The bar's name says the same. */}
      <Text role="mono" tone="secondary" hidden={true}>
        {t('onboarding:progress.count', { step, total: TOTAL })}
      </Text>
    </View>
  );
}
