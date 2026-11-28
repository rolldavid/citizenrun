import type { Me } from '@citizenrun/shared';
import { useEffect, useRef, useState } from 'react';

import {
  failureOfAttach,
  setHandleRefusal,
  useAvatarPhoto,
  useHandleCheck,
} from '@/features/onboarding';
import { useMe, writeMeToCache } from '@/features/system';
import { failureCode, useIsOnline, viewStateOf } from '@/lib/view-models/query';
import type { ApiFailure } from '@/lib/view-models/query';
import { queryClient } from '@/platform/query-client';

import { changeHandle, updateProfile } from '../data/profile-requests';

import { profileChanges } from './profile-changes';
import type { ProfileInput } from './profile-changes';
import type { SettingsProfileViewModel } from './settings-profile.types';

type ProfileData = Extract<SettingsProfileViewModel, { status: 'ready' }>['data'];
type Save = ProfileData['save'];
type FieldKey = keyof Save['fields'];

const SAVE_IDLE: Save = { status: 'idle', fields: {}, errorCode: null };
const SAVE_SENDING: Save = { status: 'sending', fields: {}, errorCode: null };
const SAVE_SAVED: Save = { status: 'saved', fields: {}, errorCode: null };

// The field's own line already says why (SCR-onboarding-handle)
const HANDLE_NOT_SENDABLE: ReadonlySet<ProfileData['handle']['check']> = new Set([
  'checking',
  'invalid',
  'reserved',
  'taken',
]);

const TEXT_FIELDS: readonly FieldKey[] = ['name', 'bio', 'link'];

function fieldsOf(failure: ApiFailure): Save['fields'] {
  if (failure.kind !== 'api') return {};
  const fields: Save['fields'] = {};
  for (const key of TEXT_FIELDS) {
    const code = failure.fields[key];
    if (code !== undefined) fields[key] = code;
  }
  return fields;
}

function isRefusal(failure: ApiFailure, code: string): boolean {
  return failure.kind === 'api' && failure.code === code;
}

function writeMe(me: Me): void {
  writeMeToCache(queryClient.get(), me);
}

/** SCR-settings-profile: E-ME-02, then E-ME-08; E-UPL-01 for the photo. */
export function useSettingsProfileViewModel(): SettingsProfileViewModel {
  const { me, source } = useMe();
  const online = useIsOnline();
  const avatar = useAvatarPhoto();
  const checker = useHandleCheck({ ownHandle: me?.handle ?? null });
  const [save, setSave] = useState<Save>(SAVE_IDLE);
  const sending = useRef(false);
  const sendWhenReady = useRef(false);
  const photoBusy = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function isMounted(): boolean {
    return mounted.current;
  }

  async function attachPhoto(): Promise<void> {
    photoBusy.current = true;
    const sent = await avatar.upload();
    if (!sent.ok) {
      photoBusy.current = false;
      return;
    }
    const outcome = await updateProfile({ avatarUploadKey: sent.key });
    photoBusy.current = false;
    if (outcome.ok) {
      writeMe(outcome.value);
      if (!isMounted()) return;
      avatar.attached();
      avatar.clear();
      return;
    }
    if (!isMounted()) return;
    avatar.fail(failureOfAttach(outcome.failure));
    if (isRefusal(outcome.failure, 'upload_invalid')) {
      avatar.attached();
    }
  }

  // The latest render's attachPhoto, for the effect below
  const attachLatest = useRef(attachPhoto);
  useEffect(() => {
    attachLatest.current = attachPhoto;
  });

  // The photo is saved by its own buttons: sent as soon as it is prepared
  const photoStatus = avatar.photo.status;
  useEffect(() => {
    if (photoStatus !== 'ready' || !sendWhenReady.current || !online) return;
    sendWhenReady.current = false;
    void attachLatest.current();
  }, [photoStatus, online]);

  const onChoosePhoto = (): void => {
    if (!online || photoBusy.current) return;
    sendWhenReady.current = true;
    avatar.choose();
  };

  const onRemovePhoto = (): void => {
    if (!online || photoBusy.current || avatar.photo.status === 'uploading') return;
    photoBusy.current = true;
    sendWhenReady.current = false;
    setSave((current) => ({ ...current, errorCode: null }));
    void updateProfile({ avatarUploadKey: null }).then((outcome) => {
      photoBusy.current = false;
      if (outcome.ok) {
        writeMe(outcome.value);
        if (isMounted()) avatar.clear();
        return;
      }
      if (isMounted()) {
        setSave((current) => ({ ...current, errorCode: failureCode(outcome.failure) }));
      }
    });
  };

  async function sendChanges(base: Me, input: ProfileInput): Promise<void> {
    const changes = profileChanges(base, input);
    if (changes.body !== null) {
      const patched = await updateProfile(changes.body);
      if (!patched.ok) {
        sending.current = false;
        if (!isMounted()) return;
        const { failure } = patched;
        if (isRefusal(failure, 'invalid_request')) {
          setSave({ status: 'idle', fields: fieldsOf(failure), errorCode: null });
          return;
        }
        setSave({ status: 'idle', fields: {}, errorCode: failureCode(failure) });
        return;
      }
      writeMe(patched.value);
    }
    if (changes.handle !== null) {
      const changed = await changeHandle(changes.handle);
      if (!changed.ok) {
        sending.current = false;
        if (!isMounted()) return;
        const refusal = setHandleRefusal(changed.failure);
        if (refusal.kind === 'check') {
          checker.set(refusal.state);
          setSave(SAVE_IDLE);
        } else {
          setSave({ status: 'idle', fields: {}, errorCode: refusal.errorCode });
        }
        return;
      }
      writeMe(changed.value);
    }
    sending.current = false;
    if (isMounted()) setSave(SAVE_SAVED);
  }

  const onSave = (input: ProfileInput): void => {
    if (!online || sending.current || me === null) return;
    const changes = profileChanges(me, input);
    if (changes.body === null && changes.handle === null) return;
    if (changes.handle !== null && HANDLE_NOT_SENDABLE.has(checker.check)) return;
    sending.current = true;
    setSave(SAVE_SENDING);
    void sendChanges(me, input);
  };

  const view = viewStateOf<ProfileData | null>(
    [source],
    () =>
      me === null
        ? null
        : {
            me,
            photo: avatar.photo,
            handle: {
              check: checker.check,
              invalidReason: checker.invalidReason,
              onChange: checker.onChange,
            },
            save,
            onChoosePhoto,
            onRemovePhoto,
            onSave,
          },
    online,
  );
  if (view.status !== 'ready') {
    return view;
  }
  if (view.data === null) {
    return { status: 'loading' };
  }
  return { ...view, data: view.data };
}
