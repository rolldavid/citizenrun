import type { Me } from '@citizenrun/shared';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import type { OnboardingPhotoViewModel } from '@/features/onboarding';
import { Avatar } from '@/ui/components/avatar';
import type { AvatarProps } from '@/ui/components/avatar';
import { Button } from '@/ui/components/button';
import { Notice } from '@/ui/components/notice';
import { Progress } from '@/ui/components/progress';
import { Text } from '@/ui/components/text';
import { space } from '@/ui/tokens';

import { photoFailureText } from './photo-failure';
import { SETTINGS_NAMESPACES } from './settings-translation';

type Photo = OnboardingPhotoViewModel['photo'];

export type ProfilePhotoControlProps = {
  me: Me;
  /** A newly chosen photo on its way to the profile. */
  photo: Photo;
  /** Shown from the cache without a connection: neither button takes a press. */
  stale: boolean;
  onChoose: () => void;
  onRemove: () => void;
};

const AVATAR: ViewStyle = { marginTop: space.x2 };
const PENDING: ViewStyle = { marginTop: space.x2 };
const UPLOAD: ViewStyle = { marginTop: space.x3, gap: space.x1 };
// The buttons keep their own width and go one under the other where a line cannot hold both.
const BUTTONS: ViewStyle = {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: space.x2,
  marginTop: space.x4,
};
const FAILURE: ViewStyle = { marginTop: space.x3 };

/** The picture the disc shows: the newly chosen photo, else the profile's, else none. */
function imageOf(me: Me, photo: Photo): AvatarProps['image'] {
  const previewUri = photo.status === 'none' ? null : photo.previewUri;
  if (previewUri !== null) {
    return { key: previewUri, url: previewUri };
  }
  return me.avatar === null ? null : { key: me.avatar.key, url: me.avatar.url };
}

/**
 * The profile photo and its two buttons. A photo is saved by these buttons alone: choosing one
 * sends it, and Remove takes the current one away. Remove is offered only for a photo the profile
 * already has.
 */
export function ProfilePhotoControl({
  me,
  photo,
  stale,
  onChoose,
  onRemove,
}: ProfilePhotoControlProps): JSX.Element {
  const { t } = useTranslation(SETTINGS_NAMESPACES);
  const uploading = photo.status === 'uploading';

  return (
    <View>
      <Text role="label">{t('settings:profile.photoLabel')}</Text>
      <View style={AVATAR}>
        <Avatar size="xl" image={imageOf(me, photo)} name={me.name} handle={me.handle} />
      </View>
      {me.avatarPending ? (
        <View style={PENDING}>
          <Text role="caption" tone="secondary">
            {t('profile:own.avatarPending')}
          </Text>
        </View>
      ) : null}
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
      <View style={BUTTONS}>
        <Button
          variant="secondary"
          label={stale ? t('common:states.offlineAction') : t('settings:profile.changePhoto')}
          onPress={onChoose}
          disabled={stale}
          busy={uploading}
          testID="settings.profile-change-photo"
        />
        {me.avatar !== null && photo.status === 'none' && !stale ? (
          <Button
            variant="secondary"
            label={t('settings:profile.removePhoto')}
            onPress={onRemove}
            testID="settings.profile-remove-photo"
          />
        ) : null}
      </View>
      {photo.status === 'failed' ? (
        <View style={FAILURE}>
          <Notice kind="error" text={photoFailureText(photo.failure, t)} />
        </View>
      ) : null}
    </View>
  );
}
