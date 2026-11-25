import type { UploadTicket } from '@citizenrun/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sendWithXhr } from './send';
import type * as NativeIndex from './index.native';
import type * as WebIndex from './index.web';
import type { PreparedFile, SendOutcome, SendProgress } from './types';

const fs = vi.hoisted(() => ({ missing: new Set<string>() }));

vi.mock('expo-file-system', () => {
  class File {
    readonly uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists(): boolean {
      return !fs.missing.has(this.uri);
    }
    get size(): number {
      return 1;
    }
    delete(): void {
      fs.missing.add(this.uri);
    }
  }
  return { File };
});
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: vi.fn(),
  getMediaLibraryPermissionsAsync: vi.fn(),
}));
vi.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: { manipulate: vi.fn() },
}));

/** A recording stand-in for the platform's FormData: entries in the order appended. */
class FakeFormData {
  readonly entries: [string, unknown][] = [];
  append(name: string, value: unknown): void {
    this.entries.push([name, value]);
  }
}

/** A recording stand-in for XMLHttpRequest that answers only when a test tells it to. */
class FakeXhr {
  static made: FakeXhr[] = [];
  readonly upload: { onprogress: ((event: { loaded: number; total: number }) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  withCredentials: boolean | null = null;
  status = 0;
  opened: [string, string] | null = null;
  readonly headers: [string, string][] = [];
  body: unknown = null;
  sent = false;
  aborted = false;

  constructor() {
    FakeXhr.made.push(this);
  }
  open(method: string, url: string): void {
    this.opened = [method, url];
  }
  setRequestHeader(name: string, value: string): void {
    this.headers.push([name, value]);
  }
  send(body: unknown): void {
    this.sent = true;
    this.body = body;
  }
  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }
  respond(status: number): void {
    this.status = status;
    this.onload?.();
  }
}

function only(): FakeXhr {
  expect(FakeXhr.made).toHaveLength(1);
  const xhr = FakeXhr.made[0];
  if (xhr === undefined) {
    throw new Error('no request was made');
  }
  return xhr;
}

const T0 = Date.parse('2026-11-25T12:00:00.000Z');
const EXPIRES = '2026-11-25T12:05:00.000Z';

const TICKET: UploadTicket = {
  uploadId: '0b7e4bd8-62a4-4c8e-9a52-5d2f0c1e7a10',
  key: 'avatars/fixture-user/fixture-key.jpg',
  method: 'POST',
  url: 'https://media.example.test/',
  fields: {
    key: 'avatars/fixture-user/fixture-key.jpg',
    policy: 'fixture-policy',
    'x-amz-signature': 'fixture-signature',
  },
  headers: {},
  maxBytes: 8_388_608,
  expiresAt: EXPIRES,
};

const PREPARED: PreparedFile = {
  kind: 'photo',
  contentType: 'image/jpeg',
  size: 500_000,
  width: 1080,
  height: 1080,
  durationMs: null,
  previewUri: 'file:///cache/fixture-prepared.jpg',
};

const BLOB = new Blob(['fixture bytes'], { type: 'image/jpeg' });

function options(signal: AbortSignal = new AbortController().signal): {
  onProgress: (p: SendProgress) => void;
  signal: AbortSignal;
  progress: SendProgress[];
} {
  const progress: SendProgress[] = [];
  return { onProgress: (p) => progress.push(p), signal, progress };
}

beforeEach(() => {
  FakeXhr.made = [];
  fs.missing.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  vi.stubGlobal('FormData', FakeFormData);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function answer(status: number, at: number = T0): Promise<SendOutcome> {
  const pending = sendWithXhr(PREPARED, TICKET, BLOB, options());
  vi.setSystemTime(at);
  only().respond(status);
  return pending;
}

describe('sendWithXhr', () => {
  it('fields first, file last', async () => {
    const pending = sendWithXhr(PREPARED, TICKET, BLOB, options());
    const xhr = only();
    expect(xhr.opened).toEqual(['POST', TICKET.url]);
    expect(xhr.body).toBeInstanceOf(FakeFormData);
    const form = xhr.body as FakeFormData; // checked on the line above
    expect(form.entries.map(([name]) => name)).toEqual([
      'key',
      'policy',
      'x-amz-signature',
      'file',
    ]);
    expect(form.entries.slice(0, 3)).toEqual(Object.entries(TICKET.fields));
    expect(form.entries[3]?.[1]).toBe(BLOB);
    xhr.respond(204);
    await expect(pending).resolves.toEqual({ kind: 'sent', key: TICKET.key });
  });

  it('no credentials', async () => {
    const ticket: UploadTicket = {
      ...TICKET,
      method: 'PUT',
      fields: {},
      headers: {
        'Content-Type': 'image/jpeg',
        Authorization: 'Bearer fixture',
        cookie: 'fixture=1',
        'X-OS-Client': 'ios/1.0.0',
      },
    };
    const post = sendWithXhr(PREPARED, TICKET, BLOB, options());
    const postXhr = only();
    expect(postXhr.withCredentials).toBe(false);
    expect(postXhr.headers).toEqual([]);
    postXhr.respond(204);
    await post;

    FakeXhr.made = [];
    const put = sendWithXhr(PREPARED, ticket, BLOB, options());
    const putXhr = only();
    expect(putXhr.withCredentials).toBe(false);
    const names = putXhr.headers.map(([name]) => name.toLowerCase());
    expect(names).toEqual(['content-type']);
    putXhr.respond(200);
    await expect(put).resolves.toEqual({ kind: 'sent', key: TICKET.key });
  });

  it('progress', async () => {
    const opts = options();
    const pending = sendWithXhr(PREPARED, TICKET, BLOB, opts);
    const xhr = only();
    xhr.upload.onprogress?.({ loaded: 200_000, total: 500_000 });
    xhr.upload.onprogress?.({ loaded: 500_000, total: 500_000 });
    xhr.respond(204);
    await pending;
    expect(opts.progress).toEqual([
      { sentBytes: 200_000, totalBytes: 500_000 },
      { sentBytes: 500_000, totalBytes: 500_000 },
    ]);
  });

  it('status mapping', async () => {
    const afterExpiry = Date.parse(EXPIRES) + 1_000;
    await expect(answer(204)).resolves.toEqual({ kind: 'sent', key: TICKET.key });
    FakeXhr.made = [];
    await expect(answer(403, afterExpiry)).resolves.toEqual({ kind: 'expired' });
    FakeXhr.made = [];
    vi.setSystemTime(T0);
    await expect(answer(403)).resolves.toEqual({ kind: 'refused', status: 403 });
    FakeXhr.made = [];
    await expect(answer(400)).resolves.toEqual({ kind: 'refused', status: 400 });
    FakeXhr.made = [];
    await expect(answer(0)).resolves.toEqual({ kind: 'failed', code: 'upload.network' });
    FakeXhr.made = [];
    await expect(answer(503)).resolves.toEqual({ kind: 'failed', code: 'upload.network' });
  });

  it('network errors and timeouts', async () => {
    const failing = sendWithXhr(PREPARED, TICKET, BLOB, options());
    only().onerror?.();
    await expect(failing).resolves.toEqual({ kind: 'failed', code: 'upload.network' });

    FakeXhr.made = [];
    const slow = sendWithXhr(PREPARED, TICKET, BLOB, options());
    only().ontimeout?.();
    await expect(slow).resolves.toEqual({ kind: 'failed', code: 'upload.network' });
  });

  it('expired before sending', async () => {
    vi.setSystemTime(Date.parse(EXPIRES));
    await expect(sendWithXhr(PREPARED, TICKET, BLOB, options())).resolves.toEqual({
      kind: 'expired',
    });
    expect(FakeXhr.made).toEqual([]);
  });

  it('over the policy size', async () => {
    const large: PreparedFile = { ...PREPARED, size: 9_000_000 };
    await expect(sendWithXhr(large, TICKET, BLOB, options())).resolves.toEqual({
      kind: 'refused',
      status: 413,
    });
    expect(FakeXhr.made).toEqual([]);
  });

  it('cancel', async () => {
    const controller = new AbortController();
    const opts = options(controller.signal);
    const pending = sendWithXhr(PREPARED, TICKET, BLOB, opts);
    const xhr = only();
    controller.abort();
    expect(xhr.aborted).toBe(true);
    await expect(pending).resolves.toEqual({ kind: 'cancelled' });
    // a late answer changes nothing
    xhr.respond(204);
    xhr.upload.onprogress?.({ loaded: 1, total: 1 });
    expect(opts.progress).toEqual([]);
  });

  it('an aborted signal sends nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(sendWithXhr(PREPARED, TICKET, BLOB, options(controller.signal))).resolves.toEqual({
      kind: 'cancelled',
    });
    expect(FakeXhr.made).toEqual([]);
  });

  it('put fallback', async () => {
    const ticket: UploadTicket = {
      ...TICKET,
      method: 'PUT',
      url: 'https://media.example.test/fixture-put',
      fields: {},
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '500000' },
    };
    const pending = sendWithXhr(PREPARED, ticket, BLOB, options());
    const xhr = only();
    expect(xhr.opened).toEqual(['PUT', ticket.url]);
    expect(xhr.headers).toEqual([
      ['Content-Type', 'image/jpeg'],
      ['Content-Length', '500000'],
    ]);
    expect(xhr.body).toBe(BLOB);
    xhr.respond(200);
    await expect(pending).resolves.toEqual({ kind: 'sent', key: ticket.key });
  });
});

describe('send on each platform', () => {
  async function nativeUpload(): Promise<(typeof NativeIndex)['upload']> {
    vi.resetModules();
    return (await vi.importActual<typeof NativeIndex>('./index.native')).upload;
  }

  async function webUpload(): Promise<(typeof WebIndex)['upload']> {
    vi.resetModules();
    return (await vi.importActual<typeof WebIndex>('./index.web')).upload;
  }

  it('phones send a named part', async () => {
    const upload = await nativeUpload();
    const pending = upload.send(PREPARED, TICKET, options());
    const xhr = only();
    const form = xhr.body as FakeFormData; // the fake FormData stubbed in beforeEach
    expect(form.entries.at(-1)).toEqual([
      'file',
      { uri: PREPARED.previewUri, name: 'upload.jpg', type: 'image/jpeg' },
    ]);
    xhr.respond(204);
    await expect(pending).resolves.toEqual({ kind: 'sent', key: TICKET.key });
  });

  it('missing file', async () => {
    fs.missing.add(PREPARED.previewUri);
    const native = await nativeUpload();
    await expect(native.send(PREPARED, TICKET, options())).resolves.toEqual({
      kind: 'failed',
      code: 'upload.file_missing',
    });
    expect(FakeXhr.made).toEqual([]);

    // the web sends only a blob it holds; a URI it never prepared has none
    const web = await webUpload();
    await expect(
      web.send({ ...PREPARED, previewUri: 'blob:fixture-unknown' }, TICKET, options()),
    ).resolves.toEqual({ kind: 'failed', code: 'upload.file_missing' });
    expect(FakeXhr.made).toEqual([]);
  });
});
