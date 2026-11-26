import { useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { Button } from '@/ui/components/button';
import { Sheet } from '@/ui/components/sheet';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

import { SETTINGS_NAMESPACES } from './settings-translation';

export type AiConsentSheetProps = {
  open: boolean;
  /** The answer is on its way. */
  busy: boolean;
  onAnswer: (allow: boolean) => void;
};

// Words, not a control: the focus they hold draws no ring.
const QUESTION: ViewStyle = { outlineStyle: 'solid', outlineWidth: 0 };
const SENTENCE: ViewStyle = { marginTop: space.x3 };
const NOTE: ViewStyle = { marginTop: space.x2 };
// Two buttons of one width, side by side: neither answer is the easier one to give.
const ANSWERS: ViewStyle = { flexDirection: 'row', gap: space.x2, marginTop: space.x6 };
const HALF: ViewStyle = { flex: 1 };

/** Closing is never an answer, so the sheet has no way to close but its two buttons. */
function stay(): void {
  // nothing to do
}

/**
 * The AI-screening question, asked at a bio edit by a person who has not answered it (D-351,
 * CTL-77): the sentence as written, and two answers of equal weight. While an answer is on its way
 * the pressed button waits and the other takes no press.
 */
export function AiConsentSheet({ open, busy, onAnswer }: AiConsentSheetProps): JSX.Element {
  const { t } = useTranslation(SETTINGS_NAMESPACES);
  // The answer that was pressed, which marks the button that waits.
  const [pressed, setPressed] = useState<boolean | null>(null);

  const answer = (allow: boolean): void => {
    setPressed(allow);
    onAnswer(allow);
  };

  return (
    <Sheet open={open} onClose={stay} dismissible={false} testID="settings.ai-consent">
      {/* The question takes the focus a sheet gives its first control, so neither answer has it. */}
      <View tabIndex={-1} style={QUESTION}>
        <Text role="heading" heading={2}>
          {t('auth:ai.title')}
        </Text>
        <View style={SENTENCE}>
          <Text role="body">{t('auth:ai.sentence')}</Text>
        </View>
        <View style={NOTE}>
          <Text role="caption" tone="secondary">
            {t('auth:ai.declineNote')}
          </Text>
        </View>
      </View>
      <View style={ANSWERS}>
        <View style={HALF}>
          <Button
            variant="secondary"
            label={t('auth:ai.dontAllow')}
            onPress={() => {
              answer(false);
            }}
            busy={busy && pressed === false}
            disabled={busy && pressed !== false}
            fullWidth={true}
            testID="settings.ai-consent-decline"
          />
        </View>
        <View style={HALF}>
          <Button
            variant="primary"
            label={t('auth:ai.allow')}
            onPress={() => {
              answer(true);
            }}
            busy={busy && pressed === true}
            disabled={busy && pressed !== true}
            fullWidth={true}
            testID="settings.ai-consent-allow"
          />
        </View>
      </View>
    </Sheet>
  );
}
