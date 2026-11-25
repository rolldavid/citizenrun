import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { CompletedPart, S3Client } from '@aws-sdk/client-s3';
import { abortReason } from './dump.ts';

/** The size of one multipart part (PC9-06). */
export const PART_BYTES = 64 * 1024 * 1024;

/** How long the cleanup abort of a failed upload may take before it is left to the store (D-828). */
export const ABORT_UPLOAD_LIMIT_MS = 10_000;

// Sends the abort of a failed multipart upload with its own signal, cut off after
// ABORT_UPLOAD_LIMIT_MS, so a store that stalls cannot hold the run open. Never throws.
async function abortUpload(
  s3: S3Client,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve();
    }, ABORT_UPLOAD_LIMIT_MS);
  });
  try {
    await Promise.race([
      s3
        .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }), {
          abortSignal: controller.signal,
        })
        .then(
          () => undefined,
          () => undefined,
        ),
      limit,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Fills `buffer` from `position` until it is full or the file ends; returns the bytes read.
async function readPart(handle: FileHandle, buffer: Buffer, position: number): Promise<number> {
  let filled = 0;
  while (filled < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      filled,
      buffer.length - filled,
      position + filled,
    );
    if (bytesRead === 0) {
      break;
    }
    filled += bytesRead;
  }
  return filled;
}

/**
 * Uploads `file` to `bucket` under `key` as a multipart upload in parts of `partBytes`, one part at
 * a time (each part reuses one buffer). The create, every part and the completion are sent with
 * `signal`. On any failure or abort after the upload is created, the multipart upload is aborted,
 * within ABORT_UPLOAD_LIMIT_MS, and the original error rethrown (D-828).
 */
export async function uploadMultipart(
  s3: S3Client,
  bucket: string,
  key: string,
  file: string,
  opts?: { readonly signal?: AbortSignal; readonly partBytes?: number },
): Promise<{ bytes: number }> {
  const partBytes = opts?.partBytes ?? PART_BYTES;
  if (!Number.isInteger(partBytes) || partBytes < 1) {
    throw new RangeError('partBytes must be a positive integer');
  }
  const signal = opts?.signal;
  const sendOptions = signal === undefined ? {} : { abortSignal: signal };

  const created = await s3.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      ContentType: 'application/octet-stream',
    }),
    sendOptions,
  );
  const uploadId = created.UploadId;
  if (uploadId === undefined) {
    throw new Error('multipart upload has no id');
  }

  let handle: FileHandle | null = null;
  try {
    handle = await open(file, 'r');
    const buffer = Buffer.allocUnsafe(partBytes);
    const parts: CompletedPart[] = [];
    let bytes = 0;
    for (let partNumber = 1; ; partNumber += 1) {
      if (signal?.aborted === true) {
        throw abortReason(signal);
      }
      const read = await readPart(handle, buffer, bytes);
      if (read === 0) {
        break;
      }
      // The part is awaited before the next read, so the reused buffer is never sent twice at once.
      const sent = await s3.send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: buffer.subarray(0, read),
          ContentLength: read,
        }),
        sendOptions,
      );
      if (sent.ETag === undefined) {
        throw new Error('uploaded part has no ETag');
      }
      parts.push({ PartNumber: partNumber, ETag: sent.ETag });
      bytes += read;
    }
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
      sendOptions,
    );
    return { bytes };
  } catch (error) {
    // Not sent with `signal`, which may be the reason for the abort.
    await abortUpload(s3, bucket, key, uploadId);
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
