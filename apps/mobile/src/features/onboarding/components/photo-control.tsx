import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { OnboardingPhotoViewModel } from '@/features/onboarding/view-models/photo.types';
import { Avatar } from '@/ui/components/avatar';
import { Button } from '@/ui/components/button';
import { Progress } from '@/ui/components/progress';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

import { useTight } from './use-tight';

export type PhotoControlProps = {
  photo: OnboardingPhotoViewModel['photo'];
  skipStatus: OnboardingPhotoViewModel['skipStatus'];
  onChoose: () => void;
  onSkip: () => void;
};

const UPLOAD: ViewStyle = { marginTop: space.x3, gap: space.x1 };
// The two buttons share the row equally: skipping is as easy to find as choosing.
const SIDE_BY_SIDE: ViewStyle = { flexDirection: 'row', gap: space.x2, marginTop: space.x6 };
const HALF: ViewStyle = { flex: 1 };
// On a tight layout a label would wrap and leave its button taller than the other, so the two
// stand one over the other, each as wide as the column.
const STACKED: ViewStyle = { gap: space.x2, marginTop: space.x6 };

/**
 * The photo step's control: the photo as others will see it, or a bare disc, and two buttons of
 * one look and one size, to choose a photo and to skip. While a photo is sent or the skip is
 * saved, neither button starts anything else.
 */
export function PhotoControl({
  photo,
  skipStatus,
  onChoose,
  onSkip,
}: PhotoControlProps): JSX.Element {
  const { t } = useTranslation(['onboarding']);
  const tight = useTight();
  const previewUri = photo.status === 'none' ? null : photo.previewUri;
  const uploading = photo.status === 'uploading';
  const skipping = skipStatus === 'sending';

  return (
    <View>
      {/* The person has no name yet: the disc says nothing to a screen reader. */}
      <Avatar
        size="xl"
        image={previewUri === null ? null : { key: previewUri, url: previewUri }}
        name={null}
        handle={null}
        decorative={true}
      />
      {photo.status === 'uploading' ? (
        <View style={UPLOAD}>
          <Progress
            kind="amount"
            value={photo.sentBytes}
            max={photo.totalBytes}
            label={t('onboarding:photo.uploading')}
          />
          <Text role="caption" tone="secondary" hidden={true}>
            {t('onboarding:photo.uploading')}
          </Text>
        </View>
      ) : null}
      <View style={tight ? STACKED : SIDE_BY_SIDE}>
        <View style={tight ? null : HALF}>
          <Button
            variant="secondary"
            label={
              previewUri === null
                ? t('onboarding:photo.choose')
                : t('onboarding:photo.chooseAnother')
            }
            onPress={onChoose}
            disabled={uploading || skipping}
            fullWidth={true}
            testID="onboarding.photo-choose"
          />
        </View>
        <View style={tight ? null : HALF}>
          <Button
            variant="secondary"
            label={t('onboarding:photo.skip')}
            onPress={onSkip}
            disabled={uploading}
            busy={skipping}
            fullWidth={true}
            testID="onboarding.photo-skip"
          />
        </View>
      </View>
    </View>
  );
}
