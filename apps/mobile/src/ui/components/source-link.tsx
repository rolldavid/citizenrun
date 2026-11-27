import { assertNever } from '@citizenrun/shared';
import type { TFunction } from 'i18next';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { useTheme } from '@/ui/theme';
import { radius, rule, size, space } from '@/ui/tokens';

import { ConfidenceBadge } from './confidence-badge';
import { Icon } from './icon';
import { Pressable } from './pressable';
import { Text } from './text';

export type SourceLinkProps = {
  /** The confidence of the source, said before its text; null draws no mark. */
  confidence: 'high' | 'medium' | 'low' | null;
  /** The source line, already translated: the host and the date checked on a page. */
  text: string;
  /** Opens the sources sheet. */
  onPress: () => void;
  testID: string;
};

type Confidence = NonNullable<SourceLinkProps['confidence']>;

// The whole row is the target, at least as high as the smallest one.
const ROW: ViewStyle = {
  minHeight: size.target,
  justifyContent: 'center',
  paddingVertical: space.x2,
};
// The mark and the chevron stand on the first line.
const LINE: ViewStyle = { flexDirection: 'row', alignItems: 'flex-start', gap: space.x2 };
// The words follow the mark on its line while both fit, and go under it when they do not, so a
// narrow row still gives the words its whole width and the date at their end is not cut.
const PROOF: ViewStyle = {
  flex: 1,
  minWidth: 0,
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  columnGap: space.x2,
};
const WORDS: ViewStyle = { flexShrink: 1, maxWidth: '100%', alignItems: 'flex-start' };
const UNDERLINED: ViewStyle = { maxWidth: '100%' };

/** The row's accessible name: the confidence in words, then the source line (one catalog string). */
function nameOf(confidence: Confidence, text: string, t: TFunction): string {
  switch (confidence) {
    case 'high':
      return t('ui.sourceLink.high', { text });
    case 'medium':
      return t('ui.sourceLink.medium', { text });
    case 'low':
      return t('ui.sourceLink.low', { text });
    default:
      return assertNever(confidence);
  }
}

/**
 * C-SourceLink: the source of a figure, one tap from it. One row that is one target: the
 * confidence mark, the source line in grey mono, and a chevron. The line is underlined under a
 * pointer and on keyboard focus. It only calls `onPress`; it opens no address itself.
 */
export function SourceLink({ confidence, text, onPress, testID }: SourceLinkProps): JSX.Element {
  const theme = useTheme();
  const { t } = useTranslation('common');
  return (
    <Pressable
      role="button"
      label={confidence === null ? text : nameOf(confidence, text, t)}
      feedback="fill"
      hover="fill"
      radius={radius.none}
      testID={testID}
      onPress={onPress}
    >
      {({ hovered, focused }) => {
        const underlined = hovered || focused;
        return (
          <View style={ROW}>
            <View style={LINE}>
              <View style={PROOF}>
                {confidence === null ? null : (
                  // The row's name already says the confidence.
                  <View
                    aria-hidden={true}
                    accessibilityElementsHidden={true}
                    importantForAccessibility="no-hide-descendants"
                  >
                    <ConfidenceBadge kind="confidence" level={confidence} />
                  </View>
                )}
                <View style={WORDS}>
                  <View
                    style={[
                      UNDERLINED,
                      {
                        borderBottomWidth: underlined ? rule.underline : 0,
                        borderBottomColor: theme.color.textSecondary,
                        // The room the underline takes, so nothing moves when it is drawn.
                        marginBottom: underlined ? 0 : rule.underline,
                      },
                    ]}
                  >
                    {/* No line limit: a source line never loses the date at its end. */}
                    <Text role="mono" tone="secondary" selectable={true}>
                      {text}
                    </Text>
                  </View>
                </View>
              </View>
              <Icon name="chevronRight" size="small" tone="secondary" />
            </View>
          </View>
        );
      }}
    </Pressable>
  );
}
