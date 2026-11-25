import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { seededRandom } from '@citizenrun/shared/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeS3 } from './testing/fake-s3.ts';
import type { FakeS3 } from './testing/fake-s3.ts';
import { ABORT_UPLOAD_LIMIT_MS, PART_BYTES, uploadMultipart } from './upload.ts';

const BUCKET = 'fixture-backups';
const KEY = 'pg/2027/03/20270305T080004Z.dump.enc';

let dir = '';

function seededBytes(length: number, seed: number): Buffer {
  const random = seededRandom(seed);
  return Buffer.from(Array.from({ length }, () => Math.floor(random() * 256)));
}

// A client that records what the uploader sent before passing each command to the fake.
function recording(fake: FakeS3): { client: S3Client; sent: unknown[] } {
  const sent: unknown[] = [];
  const send = (command: unknown, options?: unknown): Promise<unknown> => {
    sent.push(command);
    return fake.client.send(command as never, options as never);
  };
  // test double: implements send() for the commands the backup uses
  return { client: { send } as unknown as S3Client, sent };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'upload-test-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(dir, { recursive: true, force: true });
});

describe('uploadMultipart', () => {
  it('uses 64 MiB parts by default', () => {
    expect(PART_BYTES).toBe(67_108_864);
  });

  it('uploads in parts of partBytes and completes in part order', async () => {
    const file = join(dir, 'twenty.bin');
    const content = seededBytes(20, 1);
    await writeFile(file, content);
    const fake = createFakeS3();
    const { client, sent } = recording(fake);

    const result = await uploadMultipart(client, BUCKET, KEY, file, { partBytes: 8 });

    expect(result).toEqual({ bytes: 20 });
    const parts = sent.filter((command) => command instanceof UploadPartCommand);
    expect(parts.map((part) => part.input.ContentLength)).toEqual([8, 8, 4]);
    expect(parts.map((part) => part.input.PartNumber)).toEqual([1, 2, 3]);
    const complete = sent.find((command) => command instanceof CompleteMultipartUploadCommand);
    const listed = complete?.input.MultipartUpload?.Parts ?? [];
    expect(listed.map((part) => part.PartNumber)).toEqual([1, 2, 3]);
    expect(listed.every((part) => typeof part.ETag === 'string' && part.ETag !== '')).toBe(true);
    expect(fake.calls).toEqual([
      'CreateMultipartUploadCommand',
      'UploadPartCommand',
      'UploadPartCommand',
      'UploadPartCommand',
      'CompleteMultipartUploadCommand',
    ]);
    expect(fake.objects.get(KEY)?.body.equals(content)).toBe(true);
  });

  it('a file of exactly one part sends one part', async () => {
    const file = join(dir, 'eight.bin');
    await writeFile(file, seededBytes(8, 2));
    const fake = createFakeS3();
    await uploadMultipart(fake.client, BUCKET, KEY, file, { partBytes: 8 });
    expect(fake.calls.filter((name) => name === 'UploadPartCommand')).toHaveLength(1);
  });

  it('aborts the multipart upload when a part fails', async () => {
    const file = join(dir, 'twenty.bin');
    await writeFile(file, seededBytes(20, 3));
    const fake = createFakeS3();
    const failure = new Error('part refused');
    fake.failOn('UploadPartCommand', failure);

    await expect(uploadMultipart(fake.client, BUCKET, KEY, file, { partBytes: 8 })).rejects.toBe(
      failure,
    );
    expect(fake.calls.at(-1)).toBe('AbortMultipartUploadCommand');
    expect(fake.calls).not.toContain('CompleteMultipartUploadCommand');
    expect(fake.objects.size).toBe(0);
  });

  it('a signal that fired before the start creates no upload', async () => {
    const file = join(dir, 'twenty.bin');
    await writeFile(file, seededBytes(20, 4));
    const fake = createFakeS3();
    const { client, sent } = recording(fake);
    const controller = new AbortController();
    const reason = new Error('stopped');
    controller.abort(reason);

    await expect(
      uploadMultipart(client, BUCKET, KEY, file, { signal: controller.signal, partBytes: 8 }),
    ).rejects.toBe(reason);
    expect(sent.map((command) => (command as object).constructor.name)).toEqual([
      'CreateMultipartUploadCommand',
    ]);
    expect(fake.calls).not.toContain('UploadPartCommand');
    expect(fake.objects.size).toBe(0);
  });

  it('aborts the created upload when the signal fires during a part', async () => {
    const file = join(dir, 'twenty.bin');
    await writeFile(file, seededBytes(20, 4));
    const fake = createFakeS3();
    const controller = new AbortController();
    const reason = new Error('stopped');
    const send = (command: unknown, options?: unknown): Promise<unknown> => {
      if (command instanceof UploadPartCommand) {
        controller.abort(reason);
      }
      return fake.client.send(command as never, options as never);
    };
    // test double: implements send() for the commands the backup uses
    const client = { send } as unknown as S3Client;

    await expect(
      uploadMultipart(client, BUCKET, KEY, file, { signal: controller.signal, partBytes: 8 }),
    ).rejects.toBe(reason);
    expect(fake.calls).toContain('AbortMultipartUploadCommand');
    expect(fake.calls).not.toContain('CompleteMultipartUploadCommand');
    expect(fake.objects.size).toBe(0);
  });

  it('sends the create with the signal', async () => {
    const file = join(dir, 'twenty.bin');
    await writeFile(file, seededBytes(20, 6));
    const fake = createFakeS3();
    const signals: (AbortSignal | undefined)[] = [];
    const send = (command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown> => {
      if (command instanceof CreateMultipartUploadCommand) {
        signals.push(options?.abortSignal);
      }
      return fake.client.send(command as never, options as never);
    };
    const controller = new AbortController();
    // test double: implements send() for the commands the backup uses
    const client = { send } as unknown as S3Client;
    await uploadMultipart(client, BUCKET, KEY, file, { signal: controller.signal, partBytes: 8 });
    expect(signals).toEqual([controller.signal]);
  });

  it('an abort that never answers is given up after its limit', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const file = join(dir, 'twenty.bin');
    await writeFile(file, seededBytes(20, 7));
    const fake = createFakeS3();
    const failure = new Error('part refused');
    fake.failOn('UploadPartCommand', failure);
    let abortSignal: AbortSignal | undefined;
    let aborting = (): void => undefined;
    const abortSent = new Promise<void>((resolve) => {
      aborting = resolve;
    });
    const send = (command: unknown, options?: { abortSignal?: AbortSignal }): Promise<unknown> => {
      if (command instanceof AbortMultipartUploadCommand) {
        abortSignal = options?.abortSignal;
        aborting();
        return new Promise<never>(() => undefined);
      }
      return fake.client.send(command as never, options as never);
    };
    // test double: implements send() for the commands the backup uses
    const client = { send } as unknown as S3Client;

    let settled = false;
    const upload = uploadMultipart(client, BUCKET, KEY, file, { partBytes: 8 }).finally(() => {
      settled = true;
    });
    upload.catch(() => undefined);
    await abortSent;
    await vi.advanceTimersByTimeAsync(ABORT_UPLOAD_LIMIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(upload).rejects.toBe(failure);
    expect(abortSignal?.aborted).toBe(true);
  });

  it('still rethrows the original error when the abort itself fails', async () => {
    const file = join(dir, 'twenty.bin');
    await writeFile(file, seededBytes(20, 5));
    const fake = createFakeS3();
    const failure = new Error('complete refused');
    fake.failOn('CompleteMultipartUploadCommand', failure);
    fake.failOn('AbortMultipartUploadCommand', new Error('abort refused'));

    await expect(uploadMultipart(fake.client, BUCKET, KEY, file, { partBytes: 8 })).rejects.toBe(
      failure,
    );
    expect(fake.calls.at(-1)).toBe('AbortMultipartUploadCommand');
  });

  it('a missing file aborts the created upload', async () => {
    const fake = createFakeS3();
    await expect(
      uploadMultipart(fake.client, BUCKET, KEY, join(dir, 'missing.bin'), { partBytes: 8 }),
    ).rejects.toThrow();
    expect(fake.calls).toEqual(['CreateMultipartUploadCommand', 'AbortMultipartUploadCommand']);
  });
});
