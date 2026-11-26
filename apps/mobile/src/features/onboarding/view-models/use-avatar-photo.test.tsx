import type { UploadTicket } from '@citizenrun/shared';
import { act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { upload } from '@/platform/upload';
import { apiError, configureTestApiClient, installApiStub, json } from '@/test/api-stub';
import type { ApiStub } from '@/test/api-stub';
import { uploadFake } from '@/test/platform/upload';
import { renderHookWithClient } from '@/test/render-hook';

import { useAvatarPhoto } from './use-avatar-photo';

const NOW = '2027-01-15T12:00:00.000Z';
const PICKED_URI = 'blob:fixture-picked';

function ticketNumber(index: number): UploadTicket {
  const id = `01890000-0000-7000-8000-0000000000b${String(index)}`;
  return {
    uploadId: id,
    key: `incoming/01890000-0000-7000-8000-000000000001/${id}.jpg`,
    method: 'POST',
    url: 'https://store.example.test/media',
    fields: {},
    headers: {},
    maxBytes: 8_388_608,
    expiresAt: '2027-01-15T12:05:00.000Z',
  };
}

let stub: ApiStub;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
  stub = installApiStub([
    {
      method: 'POST',
      path: '/v1/uploads',
      reply: (_request, index) => json(201, ticketNumber(index)),
    },
  ]);
  configureTestApiClient();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function scriptPhoto(width = 4000, height = 3000): void {
  uploadFake.scriptPick({
    kind: 'picked',
    items: [
      {
        kind: 'photo',
        previewUri: PICKED_URI,
        width,
        height,
        mimeType: 'image/jpeg',
        fileSize: 480_000,
      },
    ],
    truncated: false,
  });
}

function ticketRequests(): number {
  return stub.requests.filter((request) => request.path === '/v1/uploads').length;
}

function sends(): number {
  return uploadFake.calls.filter((call) => call.op === 'send').length;
}

async function readyHook() {
  const hook = renderHookWithClient(() => useAvatarPhoto());
  scriptPhoto();
  act(() => {
    hook.result.current.choose();
  });
  await waitFor(() => {
    expect(hook.result.current.photo.status).toBe('ready');
  });
  return hook;
}

async function uploadNow(hook: Awaited<ReturnType<typeof readyHook>>) {
  let answer: Awaited<ReturnType<ReturnType<typeof useAvatarPhoto>['upload']>> = { ok: false };
  await act(async () => {
    answer = await hook.result.current.upload();
  });
  return answer;
}

describe('useAvatarPhoto', () => {
  it('prepares the centred square of the picked photo', async () => {
    const prepare = vi.spyOn(upload, 'preparePhoto');
    uploadFake.scriptPrepare({
      kind: 'ready',
      file: {
        kind: 'photo',
        contentType: 'image/jpeg',
        size: 480_000,
        width: 1080,
        height: 1080,
        durationMs: null,
        previewUri: 'blob:fixture-prepared',
      },
    });
    const hook = await readyHook();

    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]?.[1]).toEqual({
      crop: { originX: 500, originY: 0, width: 3000, height: 3000 },
    });
    expect(uploadFake.calls.map((call) => call.op)).toEqual(['pickAvatarPhoto', 'preparePhoto']);
    expect(hook.result.current.photo).toEqual({
      status: 'ready',
      previewUri: 'blob:fixture-prepared',
    });
  });

  it('picks before anything is awaited', () => {
    const hook = renderHookWithClient(() => useAvatarPhoto());
    act(() => {
      hook.result.current.choose();
    });
    expect(uploadFake.calls[0]?.op).toBe('pickAvatarPhoto');
  });

  it('changes nothing when the pick is cancelled', async () => {
    const hook = await readyHook();
    const before = hook.result.current.photo;
    uploadFake.scriptPick({ kind: 'cancelled' });

    await act(async () => {
      hook.result.current.choose();
      await Promise.resolve();
    });

    expect(hook.result.current.photo).toEqual(before);
  });

  it('reports blocked photos', async () => {
    const hook = renderHookWithClient(() => useAvatarPhoto());
    uploadFake.scriptPick({ kind: 'denied', state: 'blocked' });

    act(() => {
      hook.result.current.choose();
    });

    await waitFor(() => {
      expect(hook.result.current.photo).toEqual({
        status: 'failed',
        previewUri: null,
        failure: 'photos_blocked',
      });
    });
  });

  it('sends under a fresh ticket and answers the key', async () => {
    uploadFake.scriptSendProgress([{ sentBytes: 120_000, totalBytes: 480_000 }]);
    const hook = await readyHook();

    const answer = await uploadNow(hook);

    expect(answer).toEqual({ ok: true, key: ticketNumber(0).key });
    expect(ticketRequests()).toBe(1);
    expect(stub.requests[0]?.body).toEqual({
      kind: 'photo',
      purpose: 'avatar',
      contentType: 'image/jpeg',
      size: 480_000,
    });
    expect(uploadFake.calls.filter((call) => call.op === 'send')).toEqual([
      { op: 'send', kind: 'photo', size: 480_000 },
    ]);
    expect(hook.result.current.photo).toEqual({
      status: 'uploading',
      previewUri: PICKED_URI,
      sentBytes: 120_000,
      totalBytes: 480_000,
    });
  });

  it('asks for a second ticket once when the first expired', async () => {
    uploadFake.scriptSend({ kind: 'expired' });
    const hook = await readyHook();

    const answer = await uploadNow(hook);

    expect(answer).toEqual({ ok: true, key: ticketNumber(1).key });
    expect(ticketRequests()).toBe(2);
    expect(sends()).toBe(2);
  });

  it('fails after a second expiry', async () => {
    uploadFake.scriptSend({ kind: 'expired' });
    uploadFake.scriptSend({ kind: 'expired' });
    const hook = await readyHook();

    const answer = await uploadNow(hook);

    expect(answer).toEqual({ ok: false });
    expect(ticketRequests()).toBe(2);
    expect(sends()).toBe(2);
    expect(hook.result.current.photo).toEqual({
      status: 'failed',
      previewUri: PICKED_URI,
      failure: 'upload_failed',
    });
  });

  it('does not retry a refused send', async () => {
    uploadFake.scriptSend({ kind: 'refused', status: 403 });
    const hook = await readyHook();

    expect(await uploadNow(hook)).toEqual({ ok: false });
    expect(sends()).toBe(1);
    expect(hook.result.current.photo).toMatchObject({ status: 'failed', failure: 'upload_failed' });

    expect(await uploadNow(hook)).toEqual({ ok: true, key: ticketNumber(1).key });
    expect(ticketRequests()).toBe(2);
  });

  it('retries a network failure with the same ticket while it lasts', async () => {
    uploadFake.scriptSend({ kind: 'failed', code: 'upload.network' });
    const hook = await readyHook();

    expect(await uploadNow(hook)).toEqual({ ok: false });
    expect(hook.result.current.photo).toMatchObject({ status: 'failed', failure: 'upload_failed' });

    vi.setSystemTime(new Date('2027-01-15T12:04:00.000Z'));
    expect(await uploadNow(hook)).toEqual({ ok: true, key: ticketNumber(0).key });
    expect(ticketRequests()).toBe(1);
    expect(sends()).toBe(2);
  });

  it('asks for a new ticket when the kept one has expired', async () => {
    uploadFake.scriptSend({ kind: 'failed', code: 'upload.network' });
    const hook = await readyHook();
    await uploadNow(hook);

    vi.setSystemTime(new Date('2027-01-15T12:05:00.000Z'));
    expect(await uploadNow(hook)).toEqual({ ok: true, key: ticketNumber(1).key });
    expect(ticketRequests()).toBe(2);
  });

  it('answers the sent key again until it is attached', async () => {
    const hook = await readyHook();

    expect(await uploadNow(hook)).toEqual({ ok: true, key: ticketNumber(0).key });
    expect(await uploadNow(hook)).toEqual({ ok: true, key: ticketNumber(0).key });
    expect(sends()).toBe(1);

    act(() => {
      hook.result.current.attached();
    });
    expect(await uploadNow(hook)).toEqual({ ok: true, key: ticketNumber(1).key });
    expect(ticketRequests()).toBe(2);
    expect(sends()).toBe(2);
  });

  it('shows the upload again on a retry after a refused attach, and is ready once attached', async () => {
    const hook = await readyHook();
    expect(await uploadNow(hook)).toEqual({ ok: true, key: ticketNumber(0).key });
    act(() => {
      hook.result.current.fail('upload_failed');
    });
    expect(hook.result.current.photo.status).toBe('failed');

    expect(await uploadNow(hook)).toEqual({ ok: true, key: ticketNumber(0).key });
    expect(hook.result.current.photo.status).toBe('uploading');

    act(() => {
      hook.result.current.attached();
    });
    expect(hook.result.current.photo.status).toBe('ready');
    expect(sends()).toBe(1);
  });

  it('maps a refused ticket', async () => {
    stub.use([
      { method: 'POST', path: '/v1/uploads', reply: apiError(429, 'daily_limit_reached') },
    ]);
    const hook = await readyHook();

    expect(await uploadNow(hook)).toEqual({ ok: false });
    expect(sends()).toBe(0);
    expect(hook.result.current.photo).toEqual({
      status: 'failed',
      previewUri: PICKED_URI,
      failure: 'rate_limited',
    });
  });

  it('answers nothing without a prepared photo', async () => {
    const hook = renderHookWithClient(() => useAvatarPhoto());
    let answer: unknown = null;
    await act(async () => {
      answer = await hook.result.current.upload();
    });
    expect(answer).toEqual({ ok: false });
    expect(stub.requests).toEqual([]);
  });

  it('goes back to none and releases the files when cleared', async () => {
    const hook = await readyHook();
    act(() => {
      hook.result.current.clear();
    });
    expect(hook.result.current.photo).toEqual({ status: 'none' });
    expect(uploadFake.calls.filter((call) => call.op === 'release')).toHaveLength(1);
  });

  it('releases what it made when unmounted', async () => {
    const release = vi.spyOn(upload, 'release');
    const hook = await readyHook();

    hook.unmount();

    expect(uploadFake.calls.filter((call) => call.op === 'release')).toHaveLength(1);
    expect(release.mock.calls[0]?.[0]).toHaveLength(2);
  });
});
