import type { Me } from '@citizenrun/shared';

import {
  FIXTURE_PHOTO_URI,
  fixtureAvatar,
  fixtureMe,
  noop,
} from '@/lib/view-models/__fixtures__/common';

import type { SettingsProfileViewModel } from './settings-profile.types';

type Ready = Extract<SettingsProfileViewModel, { status: 'ready' }>;
type ProfileData = Extract<SettingsProfileViewModel, { status: 'ready' }>['data'];

function meWith(overrides: Partial<Me> = {}): Me {
  return fixtureMe({
    bio: 'Fixture bio text.',
    link: 'https://example.test/fixture',
    ...overrides,
  });
}

function readyWith(overrides: Partial<ProfileData> = {}): Ready {
  return {
    status: 'ready',
    data: {
      me: meWith(),
      photo: { status: 'none' },
      handle: { check: 'idle', invalidReason: null, onChange: noop },
      save: { status: 'idle', fields: {}, errorCode: null },
      aiConsentNeeded: false,
      onAnswerAiConsent: noop,
      onChoosePhoto: noop,
      onRemovePhoto: noop,
      onSave: noop,
      ...overrides,
    },
    refreshing: false,
    stale: false,
  };
}

export const profileEdit = readyWith() satisfies SettingsProfileViewModel;

// The typed text is the screen's own state
export const profileEditDirty = readyWith({
  photo: { status: 'ready', previewUri: FIXTURE_PHOTO_URI },
}) satisfies SettingsProfileViewModel;

export const profileEditSaving = readyWith({
  save: { status: 'sending', fields: {}, errorCode: null },
}) satisfies SettingsProfileViewModel;

export const profileEditSaved = readyWith({
  save: { status: 'saved', fields: {}, errorCode: null },
}) satisfies SettingsProfileViewModel;

export const profileEditFieldErrors = readyWith({
  save: { status: 'idle', fields: { name: 'too_long', link: 'invalid_format' }, errorCode: null },
}) satisfies SettingsProfileViewModel;

export const profileEditHandleLocked = readyWith({
  me: meWith({ handleChangeAvailableAt: '2027-02-14T12:00:00.000Z' }),
}) satisfies SettingsProfileViewModel;

export const profileEditAvatarPending = readyWith({
  me: meWith({ avatar: fixtureAvatar(), avatarPending: true }),
}) satisfies SettingsProfileViewModel;

export const profileEditAiConsent = readyWith({
  aiConsentNeeded: true,
}) satisfies SettingsProfileViewModel;

export const profileEditLoading = { status: 'loading' } satisfies SettingsProfileViewModel;

export const profileEditError = {
  status: 'error',
  code: 'internal',
  onRetry: noop,
} satisfies SettingsProfileViewModel;

export const profileEditOffline = {
  status: 'offline',
  onRetry: noop,
} satisfies SettingsProfileViewModel;

export const profileEditStale = {
  ...readyWith(),
  stale: true,
} satisfies SettingsProfileViewModel;
