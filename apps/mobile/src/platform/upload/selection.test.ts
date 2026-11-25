import type { UploadTicket } from '@citizenrun/shared';
import {
  PermissionStatus,
  getMediaLibraryPermissionsAsync,
  launchImageLibraryAsync,
} from 'expo-image-picker';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';
import type { PreparedFile, UploadModule } from './types';

vi.mock('expo-image-picker', () => ({
  PermissionStatus: { GRANTED: 'granted', UNDETERMINED: 'undetermined', DENIED: 'denied' },
  launchImageLibraryAsync: vi.fn(),
  getMediaLibraryPermissionsAsync: vi.fn(),
}));
vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: vi.fn() },
}));
vi.mock('expo-file-system', () => {
  class File {
    readonly exists = true;
    readonly size = 1;
    delete(): void {
      // nothing on disk in these cases
    }
  }
  return { File };
});

const pick = vi.mocked(launchImageLibraryAsync);
const permission = vi.mocked(getMediaLibraryPermissionsAsync);

const PICKED_URI = 'blob:fixture/picked-1';

const ASSET = {
  uri: PICKED_URI,
  width: 3024,
  height: 4032,
  mimeType: 'image/heic',
  fileSize: 2_500_000,
  type: 'image' as const,
  assetId: null,
  fileName: 'fixture.heic',
};

async function load(file: 'native' | 'web'): Promise<UploadModule> {
  vi.resetModules();
  return file === 'native'
    ? (await vi.importActual<typeof NativeIndex>('./index.native')).upload
    : (await vi.importActual<typeof WebIndex>('./index.web')).upload;
}

beforeEach(() => {
  pick.mockReset();
  permission.mockReset();
});

describe('both files', () => {
  it('export the same members', async () => {
    const native = Object.keys(await load('native')).sort();
    const web = Object.keys(await load('web')).sort();
    expect(native).toEqual(web);
    expect(native).toEqual(['pickAvatarPhoto', 'preparePhoto', 'release', 'send']);
  });
});

describe.each(['native', 'web'] as const)('pickAvatarPhoto (%s)', (file) => {
  it('the avatar picker never crops', async () => {
    pick.mockResolvedValue({ canceled: true, assets: null });
    await (await load(file)).pickAvatarPhoto();
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick.mock.calls[0]).toStrictEqual([
      { mediaTypes: ['images'], allowsEditing: false, quality: 1, exif: false },
    ]);
  });

  it('cancelled', async () => {
    pick.mockResolvedValue({ canceled: true, assets: null });
    await expect((await load(file)).pickAvatarPhoto()).resolves.toEqual({ kind: 'cancelled' });
  });

  it('one photo', async () => {
    pick.mockResolvedValue({ canceled: false, assets: [ASSET] });
    await expect((await load(file)).pickAvatarPhoto()).resolves.toEqual({
      kind: 'picked',
      items: [
        {
          kind: 'photo',
          previewUri: PICKED_URI,
          width: 3024,
          height: 4032,
          mimeType: 'image/heic',
          fileSize: 2_500_000,
        },
      ],
      truncated: false,
    });
  });

  it('unreported type and size are null', async () => {
    pick.mockResolvedValue({
      canceled: false,
      assets: [{ uri: PICKED_URI, width: 10, height: 20 }],
    });
    await expect((await load(file)).pickAvatarPhoto()).resolves.toMatchObject({
      kind: 'picked',
      items: [{ mimeType: null, fileSize: null }],
    });
  });

  it('picker failure', async () => {
    pick.mockRejectedValue(new Error('fixture picker failure'));
    await expect((await load(file)).pickAvatarPhoto()).resolves.toEqual({
      kind: 'failed',
      code: 'upload.picker_failed',
    });
    expect(permission).not.toHaveBeenCalled();
  });

  it('a missing permission answers denied with its state', async () => {
    pick.mockRejectedValue(
      Object.assign(new Error('fixture'), { code: 'ERR_MISSING_CAMERA_PERMISSION' }),
    );
    permission.mockResolvedValue({
      status: PermissionStatus.DENIED,
      canAskAgain: false,
      granted: false,
      expires: 'never',
    });
    await expect((await load(file)).pickAvatarPhoto()).resolves.toEqual({
      kind: 'denied',
      state: 'blocked',
    });
  });
});

describe('the web picker', () => {
  class FakeFormData {
    readonly entries: [string, unknown][] = [];
    append(name: string, value: unknown): void {
      this.entries.push([name, value]);
    }
  }

  class FakeXhr {
    static made: FakeXhr[] = [];
    readonly upload = { onprogress: null };
    onload: (() => void) | null = null;
    withCredentials = false;
    status = 0;
    body: unknown = null;
    constructor() {
      FakeXhr.made.push(this);
    }
    open(): void {
      // the URL is not what these cases check
    }
    send(body: unknown): void {
      this.body = body;
      this.status = 204;
      this.onload?.();
    }
    abort(): void {
      // never aborted here
    }
  }

  const TICKET: UploadTicket = {
    uploadId: '0b7e4bd8-62a4-4c8e-9a52-5d2f0c1e7a10',
    key: 'avatars/fixture-user/fixture-key.jpg',
    method: 'POST',
    url: 'https://media.example.test/',
    fields: { key: 'avatars/fixture-user/fixture-key.jpg' },
    headers: {},
    maxBytes: 8_388_608,
    expiresAt: '2999-01-01T00:00:00.000Z',
  };

  let revoked: string[] = [];

  beforeEach(() => {
    FakeXhr.made = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    vi.stubGlobal('FormData', FakeFormData);
    revoked = [];
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((uri: string) => {
      revoked.push(uri);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('web keeps the file', async () => {
    const picked = new File(['fixture bytes'], 'fixture.jpg', { type: 'image/jpeg' });
    pick.mockResolvedValue({ canceled: false, assets: [{ ...ASSET, file: picked }] });
    const upload = await load('web');
    const outcome = await upload.pickAvatarPhoto();
    if (outcome.kind !== 'picked' || outcome.items[0] === undefined) {
      throw new Error('the fixture photo was not picked');
    }
    const item = outcome.items[0];
    const asPrepared: PreparedFile = {
      kind: 'photo',
      contentType: 'image/jpeg',
      size: picked.size,
      width: item.width,
      height: item.height,
      durationMs: null,
      previewUri: item.previewUri,
    };
    const signal = new AbortController().signal;

    await expect(
      upload.send(asPrepared, TICKET, { onProgress: () => undefined, signal }),
    ).resolves.toEqual({
      kind: 'sent',
      key: TICKET.key,
    });
    const form = FakeXhr.made[0]?.body as FakeFormData; // the fake FormData stubbed above
    expect(form.entries.at(-1)).toEqual(['file', picked]);

    upload.release([item]);
    expect(revoked).toEqual([PICKED_URI]);
    await expect(
      upload.send(asPrepared, TICKET, { onProgress: () => undefined, signal }),
    ).resolves.toEqual({
      kind: 'failed',
      code: 'upload.file_missing',
    });
    upload.release([item]);
    expect(revoked).toEqual([PICKED_URI]);
  });
});
