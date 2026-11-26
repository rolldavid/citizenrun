import type { UploadTicket } from '@citizenrun/shared';
import { useEffect, useRef, useState } from 'react';

import { upload } from '@/platform/upload';
import type { PickedPhoto, PreparedFile } from '@/platform/upload/types';

import { createAvatarTicket } from '../data/onboarding-requests';

import { centredSquare, failureOfPick, failureOfPrepare, failureOfTicket } from './photo-steps';
import type { OnboardingPhotoViewModel, PhotoFailure } from './photo.types';

export type AvatarPhoto = {
  photo: OnboardingPhotoViewModel['photo'];
  choose: () => void;
  /** Sends the prepared photo; answers the key to attach. A key already sent and not yet attached is answered again. */
  upload: () => Promise<{ ok: true; key: string } | { ok: false }>;
  fail: (failure: PhotoFailure) => void; // the caller reports a refused attach
  attached: () => void; // the key was attached: the next upload needs a new ticket
  clear: () => void; // back to 'none'; releases the files
};

type Photo = OnboardingPhotoViewModel['photo'];
type UploadAnswer = { ok: true; key: string } | { ok: false };

// One expired ticket is replaced once; a second expiry fails (PM-upload)
const SEND_ATTEMPTS = 2;
const NOT_SENT: UploadAnswer = { ok: false };

function hasExpired(ticket: UploadTicket): boolean {
  return Date.parse(ticket.expiresAt) <= Date.now();
}

/** Releases the kept picked and prepared items and forgets them. */
function releaseKept(
  picked: { current: PickedPhoto | null },
  prepared: { current: PreparedFile | null },
): void {
  const kept = [picked.current, prepared.current].filter(
    (item): item is PickedPhoto | PreparedFile => item !== null,
  );
  picked.current = null;
  prepared.current = null;
  if (kept.length > 0) {
    upload.release(kept);
  }
}

/** Picking, preparing and sending one avatar photo through PM-upload (D-547, D-569). */
export function useAvatarPhoto(): AvatarPhoto {
  const [photo, setPhoto] = useState<Photo>({ status: 'none' });
  // Kept in refs, never on the device
  const picked = useRef<PickedPhoto | null>(null);
  const prepared = useRef<PreparedFile | null>(null);
  const ticket = useRef<UploadTicket | null>(null);
  const sentKey = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const sending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
      controller.current = null;
      releaseKept(picked, prepared);
    };
  }, []);

  // Read through a function: an await between two reads may unmount the screen
  function isMounted(): boolean {
    return mounted.current;
  }

  function currentPreview(): string | null {
    return prepared.current === null ? null : prepared.current.previewUri;
  }

  function failWith(failure: PhotoFailure): void {
    setPhoto({ status: 'failed', previewUri: currentPreview(), failure });
  }

  async function prepareAndKeep(item: PickedPhoto): Promise<void> {
    const outcome = await upload.preparePhoto(item, { crop: centredSquare(item) });
    if (!isMounted()) {
      upload.release(outcome.kind === 'ready' ? [item, outcome.file] : [item]);
      return;
    }
    if (outcome.kind !== 'ready') {
      upload.release([item]);
      const failure = failureOfPrepare(outcome);
      if (failure !== null) failWith(failure);
      return;
    }
    releaseKept(picked, prepared);
    picked.current = item;
    prepared.current = outcome.file;
    ticket.current = null;
    sentKey.current = null;
    setPhoto({ status: 'ready', previewUri: outcome.file.previewUri });
  }

  const choose = (): void => {
    if (sending.current) return;
    // Called before any await: the web opens its picker only from the tap (PM-upload)
    const picking = upload.pickAvatarPhoto();
    void picking.then(async (outcome) => {
      if (outcome.kind !== 'picked') {
        const failure = failureOfPick(outcome);
        if (failure !== null && isMounted()) failWith(failure);
        return;
      }
      const [first, ...rest] = outcome.items;
      if (rest.length > 0) upload.release(rest);
      if (first === undefined) return;
      if (!isMounted()) {
        upload.release([first]);
        return;
      }
      await prepareAndKeep(first);
    });
  };

  async function freshTicket(file: PreparedFile): Promise<UploadTicket | PhotoFailure> {
    const current = ticket.current;
    if (current !== null && !hasExpired(current)) {
      return current;
    }
    ticket.current = null;
    const answer = await createAvatarTicket({ contentType: file.contentType, size: file.size });
    if (!answer.ok) {
      return failureOfTicket(answer.failure);
    }
    ticket.current = answer.value;
    return answer.value;
  }

  async function sendKept(file: PreparedFile): Promise<UploadAnswer> {
    const previewUri = file.previewUri;
    setPhoto({ status: 'uploading', previewUri, sentBytes: 0, totalBytes: file.size });
    for (let attemptIndex = 0; attemptIndex < SEND_ATTEMPTS; attemptIndex += 1) {
      const current = await freshTicket(file);
      if (!isMounted()) return NOT_SENT;
      if (typeof current === 'string') {
        failWith(current);
        return NOT_SENT;
      }
      const abort = new AbortController();
      controller.current = abort;
      const outcome = await upload.send(file, current, {
        onProgress: ({ sentBytes, totalBytes }) => {
          if (isMounted()) {
            setPhoto({ status: 'uploading', previewUri, sentBytes, totalBytes });
          }
        },
        signal: abort.signal,
      });
      if (controller.current === abort) controller.current = null;
      if (!isMounted()) return NOT_SENT;
      switch (outcome.kind) {
        case 'sent':
          sentKey.current = outcome.key;
          return { ok: true, key: outcome.key };
        case 'expired':
          ticket.current = null;
          break;
        case 'refused':
          ticket.current = null;
          failWith('upload_failed');
          return NOT_SENT;
        case 'failed':
          failWith('upload_failed');
          return NOT_SENT;
        case 'cancelled':
          setPhoto({ status: 'ready', previewUri });
          return NOT_SENT;
      }
    }
    failWith('upload_failed');
    return NOT_SENT;
  }

  const send = async (): Promise<UploadAnswer> => {
    const file = prepared.current;
    if (file === null) return NOT_SENT;
    if (sentKey.current !== null) return { ok: true, key: sentKey.current };
    if (sending.current) return NOT_SENT;
    sending.current = true;
    try {
      return await sendKept(file);
    } finally {
      sending.current = false;
    }
  };

  const attached = (): void => {
    sentKey.current = null;
    ticket.current = null;
    setPhoto((current) =>
      current.status === 'uploading'
        ? { status: 'ready', previewUri: current.previewUri }
        : current,
    );
  };

  const fail = (failure: PhotoFailure): void => {
    failWith(failure);
  };

  const clear = (): void => {
    controller.current?.abort();
    controller.current = null;
    releaseKept(picked, prepared);
    ticket.current = null;
    sentKey.current = null;
    setPhoto({ status: 'none' });
  };

  return { photo, choose, upload: send, fail, attached, clear };
}
