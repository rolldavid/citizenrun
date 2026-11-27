import { assertNever } from '@citizenrun/shared';
import type { TFunction } from 'i18next';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';

import { Text } from './text';

export type ConfidenceBadgeProps =
  | { kind: 'confidence'; level: 'high' | 'medium' | 'low' }
  | { kind: 'record'; level: 'complete' | 'partial' | 'minimal' };

type Level = ConfidenceBadgeProps['level'];

const LINE: ViewStyle = { flexDirection: 'row', alignItems: 'center', gap: space.x2 };
const PIPS: ViewStyle = { flexDirection: 'row', gap: space.pip };
const PIP: ViewStyle = {
  width: size.confidencePip.width,
  height: size.confidencePip.height,
  borderRadius: radius.none,
};

/** How many of the pips are lit. */
function litOf(level: Level): number {
  switch (level) {
    case 'high':
    case 'complete':
      return 3;
    case 'medium':
    case 'partial':
      return 2;
    case 'low':
    case 'minimal':
      return 1;
    default:
      return assertNever(level);
  }
}

/** The level in words. */
function wordsOf(level: Level, t: TFunction): string {
  switch (level) {
    case 'high':
      return t('ui.confidence.high');
    case 'medium':
      return t('ui.confidence.medium');
    case 'low':
      return t('ui.confidence.low');
    case 'complete':
      return t('ui.record.complete');
    case 'partial':
      return t('ui.record.partial');
    case 'minimal':
      return t('ui.record.minimal');
    default:
      return assertNever(level);
  }
}

/**
 * C-ConfidenceBadge: how sure a source is, or how complete a record is, as three pips and the
 * level in words. The words carry the meaning: the pips are decoration, and no level has a color
 * or a box. It opens a source line and never stands apart from one.
 */
export function ConfidenceBadge({ level }: ConfidenceBadgeProps): JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation('common');
  const lit = litOf(level);
  const ink = theme.color.textSecondary;
  return (
    <View style={LINE}>
      <View
        style={PIPS}
        aria-hidden={true}
        accessibilityElementsHidden={true}
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length: size.confidencePips }, (_, index) => (
          <View
            key={index}
            style={[
              PIP,
              index < lit
                ? { backgroundColor: ink }
                : { borderWidth: rule.hairline, borderColor: ink },
            ]}
          />
        ))}
      </View>
      <Text role="mono" tone="secondary">
        {wordsOf(level, t)}
      </Text>
    </View>
  );
}
