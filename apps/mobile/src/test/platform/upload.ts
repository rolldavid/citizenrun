import type {
  CropRect,
  PickOutcome,
  PickedPhoto,
  PrepareOutcome,
  SendOutcome,
  SendProgress,
  UploadModule,
} from '@/platform/upload/types';

/** Never bytes, URIs, URLs, fields or keys: `kind` and `size` are null for a pick and a release. */
export type UploadFakeCall = {
  op: 'pickAvatarPhoto' | 'preparePhoto' | 'send' | 'release';
  kind: 'photo' | 'video' | null;
  size: number | null;
};

/** The fake's stand-in size of a picked photo whose size the picker did not report. */
const UNKNOWN_SIZE = 100_000;
/** The widest and tallest a fake prepared photo is. */
const MAX_SIDE = 1080;

const calls: UploadFakeCall[] = [];
const picks: PickOutcome[] = [];
const sends: SendOutcome[] = [];
const state: { prepare: PrepareOutcome | null; progress: readonly SendProgress[] | null } = {
  prepare: null,
  progress: null,
};

function preparedFrom(item: PickedPhoto, crop: CropRect | null): PrepareOutcome {
  const width = crop ? crop.width : item.width;
  const height = crop ? crop.height : item.height;
  const scale = Math.min(1, MAX_SIDE / width, MAX_SIDE / height);
  return {
    kind: 'ready',
    file: {
      kind: 'photo',
      contentType: 'image/jpeg',
      size: item.fileSize ?? UNKNOWN_SIZE,
      width: Math.round(width * scale),
      height: Math.round(height * scale),
      durationMs: null,
      previewUri: item.previewUri,
    },
  };
}

export const upload: UploadModule = {
  pickAvatarPhoto: () => {
    calls.push({ op: 'pickAvatarPhoto', kind: null, size: null });
    return Promise.resolve(picks.shift() ?? { kind: 'cancelled' });
  },
  preparePhoto: (item, { crop }) => {
    const outcome = state.prepare ?? preparedFrom(item, crop);
    calls.push({
      op: 'preparePhoto',
      kind: item.kind,
      size: outcome.kind === 'ready' ? outcome.file.size : null,
    });
    return Promise.resolve(outcome);
  },
  send: (file, ticket, { onProgress, signal }) => {
    calls.push({ op: 'send', kind: file.kind, size: file.size });
    if (signal.aborted) {
      return Promise.resolve({ kind: 'cancelled' });
    }
    for (const step of state.progress ?? [{ sentBytes: file.size, totalBytes: file.size }]) {
      onProgress(step);
    }
    return Promise.resolve(sends.shift() ?? { kind: 'sent', key: ticket.key });
  },
  release: () => {
    calls.push({ op: 'release', kind: null, size: null });
  },
};

export const uploadFake = {
  calls: calls as readonly UploadFakeCall[],
  /** Queues the answer of the next pick; an empty queue answers cancelled. */
  scriptPick: (outcome: PickOutcome): void => {
    picks.push(outcome);
  },
  /** The answer of every preparePhoto call until reset; by default a ready file made from the item. */
  scriptPrepare: (outcome: PrepareOutcome): void => {
    state.prepare = outcome;
  },
  /** The progress steps every send reports until reset; by default one step at the file's full size. */
  scriptSendProgress: (steps: readonly SendProgress[]): void => {
    state.progress = [...steps];
  },
  /** Queues the answer of the next send; an empty queue answers sent with the ticket's key. */
  scriptSend: (outcome: SendOutcome): void => {
    sends.push(outcome);
  },
  reset: (): void => {
    calls.length = 0;
    picks.length = 0;
    sends.length = 0;
    state.prepare = null;
    state.progress = null;
  },
};
