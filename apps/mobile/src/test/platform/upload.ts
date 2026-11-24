import type {
  PickOutcome,
  PickedPhoto,
  PrepareOutcome,
  UploadModule,
} from '@/platform/upload/types';

/** Never bytes or URIs: `kind` and `size` are null for a pick and a release. */
export type UploadFakeCall = {
  op: 'pickAvatarPhoto' | 'preparePhoto' | 'release';
  kind: 'photo' | 'video' | null;
  size: number | null;
};

const calls: UploadFakeCall[] = [];
const picks: PickOutcome[] = [];
const state: { prepare: PrepareOutcome | null } = { prepare: null };

function preparedFrom(item: PickedPhoto): PrepareOutcome {
  return {
    kind: 'ready',
    file: {
      kind: 'photo',
      contentType: 'image/jpeg',
      size: item.fileSize ?? 0,
      width: item.width,
      height: item.height,
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
  preparePhoto: (item) => {
    calls.push({ op: 'preparePhoto', kind: item.kind, size: item.fileSize ?? 0 });
    return Promise.resolve(state.prepare ?? preparedFrom(item));
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
  reset: (): void => {
    calls.length = 0;
    picks.length = 0;
    state.prepare = null;
  },
};
