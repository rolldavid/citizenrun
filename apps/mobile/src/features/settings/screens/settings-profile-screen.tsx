import { formatDate } from '@citizenrun/shared';
import type { Me } from '@citizenrun/shared';
import { useState } from 'react';
import type { JSX } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { ViewStyle } from 'react-native';

import { errorText } from '@/features/settings/components/error-text';
import { handleStatus } from '@/features/settings/components/handle-status';
import { localDateOf } from '@/features/settings/components/instant-text';
import { ProfilePhotoControl } from '@/features/settings/components/profile-photo-control';
import { SettingsFooter, SettingsFrame } from '@/features/settings/components/settings-frame';
import type { SettingsFooterProps } from '@/features/settings/components/settings-frame';
import { SETTINGS_NAMESPACES } from '@/features/settings/components/settings-translation';
import { useToastOn } from '@/features/settings/components/use-toast-on';
import { profileChanges } from '@/features/settings/view-models/profile-changes';
import type { SettingsProfileViewModel } from '@/features/settings/view-models/settings-profile.types';
import { useSettingsProfileViewModel } from '@/features/settings/view-models/use-settings-profile-view-model';
import { head } from '@/platform/head';
import { HandleField } from '@/ui/components/handle-field';
import { Text } from '@/ui/components/text';
import { TextField } from '@/ui/components/text-field';
import { space } from '@/ui/tokens';

type ProfileData = Extract<SettingsProfileViewModel, { status: 'ready' }>['data'];

/** What is typed into the form; it stays here until Save hands it over. */
type Typed = { name: string; bio: string; link: string; handle: string };

const NOTHING_TYPED: Typed = { name: '', bio: '', link: '', handle: '' };

// The longest a name, a bio and a link may be: the profile's own limits, not sizes.
const NAME_MAX = 50;
const BIO_MAX = 160;
const LINK_MAX = 200;

const BLOCKS: ViewStyle = { gap: space.x6 };
const HELPER: ViewStyle = { marginTop: space.x2 };

/** The profile's text as the form first shows it: a field the profile leaves out starts empty. */
function typedOf(me: Me): Typed {
  return {
    name: me.name ?? '',
    bio: me.bio ?? '',
    link: me.link ?? '',
    handle: me.handle ?? '',
  };
}

/** The handle that cannot be changed yet, with the instant from which it can; null when it can. */
function lockedHandle(me: Me): { handle: string; until: string } | null {
  return me.handle === null || me.handleChangeAvailableAt === null
    ? null
    : { handle: me.handle, until: me.handleChangeAvailableAt };
}

/** The handle's check says it cannot be claimed: saving it would do nothing. */
function handleRefused(check: ProfileData['handle']['check']): boolean {
  return check === 'checking' || check === 'taken' || check === 'reserved' || check === 'invalid';
}

/**
 * SCR-settings-profile: the photo, name, bio, link and handle. The photo is saved by its own
 * buttons; the Save bar holds the text and the handle, and waits until one of them differs from
 * the profile.
 */
export function SettingsProfileScreenView({ vm }: { vm: SettingsProfileViewModel }): JSX.Element {
  const { t, i18n } = useTranslation(SETTINGS_NAMESPACES);
  const [typed, setTyped] = useState<Typed | null>(null);

  // The profile's text is taken once, the first time the profile is there.
  let values = typed ?? NOTHING_TYPED;
  if (typed === null && vm.status === 'ready') {
    values = typedOf(vm.data.me);
    setTyped(values);
  }

  const save = vm.status === 'ready' ? vm.data.save : null;

  useToastOn(save?.status === 'saved', {
    kind: 'success',
    text: t('settings:profile.saved'),
  });

  const change = (part: Partial<Typed>): void => {
    setTyped({ ...values, ...part });
  };

  /** The line under a name or a bio the last save refused. */
  const tooLongText = (code: string | undefined, tooLong: string): string | undefined => {
    if (code === undefined) {
      return undefined;
    }
    return code === 'too_long' ? tooLong : t('errors:invalid_request');
  };

  const handleBlock = (data: ProfileData): JSX.Element => {
    const locked = lockedHandle(data.me);
    if (locked !== null) {
      // The day a new handle may be picked, as the device's own calendar has it.
      const day = localDateOf(locked.until);
      return (
        <TextField
          label={t('settings:profile.handle')}
          value={locked.handle}
          onChangeText={() => undefined}
          disabled={true}
          {...(day === null
            ? {}
            : {
                helper: t('settings:profile.handleLocked', {
                  date: formatDate(day, i18n.language, 'long'),
                }),
              })}
          testID="settings.profile-handle"
        />
      );
    }
    const status = handleStatus(data.handle, data.save.fields.handle, t);
    return (
      <View>
        <HandleField
          label={t('settings:profile.handle')}
          value={values.handle}
          onChangeText={(handle) => {
            change({ handle });
            data.handle.onChange(handle);
          }}
          check={status.check}
          statusText={status.statusText}
          testID="settings.profile-handle"
        />
        <View style={HELPER}>
          <Text role="caption" tone="secondary">
            {t('onboarding:handle.helper')}
          </Text>
        </View>
      </View>
    );
  };

  const buttonOf = (data: ProfileData, stale: boolean): SettingsFooterProps['button'] => {
    const testID = 'settings.profile-save';
    if (stale) {
      return { label: t('common:states.offlineAction'), disabled: true, testID };
    }
    const { me } = data;
    const handle = lockedHandle(me)?.handle ?? values.handle;
    const input = { name: values.name, bio: values.bio, link: values.link, handle };
    if (data.save.status === 'sending') {
      // The save on its way keeps the button, whatever the profile reads by now.
      return { label: t('common:save'), busy: true, testID };
    }
    const changes = profileChanges(me, input);
    if (changes.body === null && changes.handle === null) {
      return { label: t('settings:profile.noChanges'), disabled: true, testID };
    }
    if (changes.handle !== null && handleRefused(data.handle.check)) {
      // The field's own line says what is wrong with the handle.
      return { label: t('onboarding:handle.needHandle'), disabled: true, testID };
    }
    return {
      label: t('common:save'),
      onPress: () => {
        data.onSave(input);
      },
      testID,
    };
  };

  return (
    <SettingsFrame
      state={vm}
      title={t('settings:row.profile')}
      parentHref="/settings"
      firstGroup={null}
      testID="settings.profile"
      footer={(data, stale) => (
        <SettingsFooter
          error={data.save.errorCode === null ? null : errorText(data.save.errorCode, t)}
          button={buttonOf(data, stale)}
        />
      )}
    >
      {(data, stale) => {
        const { fields } = data.save;
        const nameError = tooLongText(fields.name, t('settings:profile.nameTooLong'));
        const bioError = tooLongText(fields.bio, t('settings:profile.bioTooLong'));
        return (
          <View style={BLOCKS}>
            <ProfilePhotoControl
              me={data.me}
              photo={data.photo}
              stale={stale}
              onChoose={data.onChoosePhoto}
              onRemove={data.onRemovePhoto}
            />
            <TextField
              label={t('settings:profile.name')}
              value={values.name}
              onChangeText={(name) => {
                change({ name });
              }}
              maxLength={NAME_MAX}
              showCount={true}
              {...(nameError === undefined ? {} : { status: 'error', statusText: nameError })}
              testID="settings.profile-name"
            />
            <TextField
              label={t('settings:profile.bio')}
              kind="multiline"
              value={values.bio}
              onChangeText={(bio) => {
                change({ bio });
              }}
              maxLength={BIO_MAX}
              showCount={true}
              {...(bioError === undefined ? {} : { status: 'error', statusText: bioError })}
              testID="settings.profile-bio"
            />
            <TextField
              label={t('settings:profile.link')}
              kind="url"
              value={values.link}
              onChangeText={(link) => {
                change({ link });
              }}
              maxLength={LINK_MAX}
              {...(fields.link === undefined
                ? {}
                : { status: 'error', statusText: t('settings:profile.linkInvalid') })}
              testID="settings.profile-link"
            />
            {handleBlock(data)}
          </View>
        );
      }}
    </SettingsFrame>
  );
}

export function SettingsProfileScreen(): JSX.Element {
  const { t } = useTranslation(['common', 'settings']);
  const vm = useSettingsProfileViewModel();
  return (
    <>
      <head.Title>{t('common:documentTitle', { title: t('settings:row.profile') })}</head.Title>
      <SettingsProfileScreenView vm={vm} />
    </>
  );
}
