import { createHash } from 'node:crypto';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';

type StoredObject = { body: Buffer; lastModified: Date };
type PendingUpload = { key: string; parts: Map<number, { body: Buffer; etag: string }> };
type SendOptions = { abortSignal?: AbortSignal };

export type FakeS3 = {
  client: S3Client;
  objects: Map<string, StoredObject>;
  calls: string[];
  failOn(commandName: string, error?: Error): void;
  headSize: Map<string, number>;
};

const DEFAULT_MAX_KEYS = 1000;

function bytesOf(body: unknown): Buffer {
  if (typeof body === 'string') {
    return Buffer.from(body, 'utf8');
  }
  if (body instanceof Uint8Array) {
    // A copy: the uploader reuses its part buffer.
    return Buffer.from(body);
  }
  throw new TypeError('fake S3 accepts string or byte bodies only');
}

function notFound(): Error {
  const error = new Error('not found');
  error.name = 'NotFound';
  return error;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new TypeError(`fake S3: ${name} is required`);
  }
  return value;
}

/**
 * An in-memory stand-in for the one bucket the backup job writes: it answers the multipart upload,
 * PutObject, HeadObject, paginated ListObjectsV2 and DeleteObject, records each command's class
 * name in `calls`, and throws for any other command. `failOn` makes every later call of a command
 * throw; `headSize` overrides the size HeadObject reports for a key.
 */
export function createFakeS3(): FakeS3 {
  const objects = new Map<string, StoredObject>();
  const calls: string[] = [];
  const failures = new Map<string, Error>();
  const headSize = new Map<string, number>();
  const uploads = new Map<string, PendingUpload>();
  let nextUpload = 1;

  const handle = (command: unknown): unknown => {
    if (command instanceof CreateMultipartUploadCommand) {
      const uploadId = `upload-${String(nextUpload)}`;
      nextUpload += 1;
      uploads.set(uploadId, { key: required(command.input.Key, 'Key'), parts: new Map() });
      return { UploadId: uploadId };
    }
    if (command instanceof UploadPartCommand) {
      const upload = uploads.get(required(command.input.UploadId, 'UploadId'));
      if (upload === undefined) {
        throw new Error('no such upload');
      }
      const body = bytesOf(command.input.Body);
      const etag = `"${createHash('md5').update(body).digest('hex')}"`;
      upload.parts.set(command.input.PartNumber ?? 0, { body, etag });
      return { ETag: etag };
    }
    if (command instanceof CompleteMultipartUploadCommand) {
      const uploadId = required(command.input.UploadId, 'UploadId');
      const upload = uploads.get(uploadId);
      if (upload === undefined) {
        throw new Error('no such upload');
      }
      const listed = command.input.MultipartUpload?.Parts ?? [];
      if (listed.length === 0) {
        throw new Error('no parts');
      }
      const bodies: Buffer[] = [];
      let previous = 0;
      for (const part of listed) {
        const number = part.PartNumber ?? 0;
        const stored = upload.parts.get(number);
        if (stored === undefined || stored.etag !== part.ETag || number <= previous) {
          throw new Error('invalid part list');
        }
        previous = number;
        bodies.push(stored.body);
      }
      objects.set(upload.key, { body: Buffer.concat(bodies), lastModified: new Date() });
      uploads.delete(uploadId);
      return {};
    }
    if (command instanceof AbortMultipartUploadCommand) {
      uploads.delete(required(command.input.UploadId, 'UploadId'));
      return {};
    }
    if (command instanceof PutObjectCommand) {
      objects.set(required(command.input.Key, 'Key'), {
        body: bytesOf(command.input.Body),
        lastModified: new Date(),
      });
      return {};
    }
    if (command instanceof HeadObjectCommand) {
      const key = required(command.input.Key, 'Key');
      const stored = objects.get(key);
      if (stored === undefined) {
        throw notFound();
      }
      return {
        ContentLength: headSize.get(key) ?? stored.body.length,
        LastModified: stored.lastModified,
      };
    }
    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix ?? '';
      const maxKeys = command.input.MaxKeys ?? DEFAULT_MAX_KEYS;
      const start = Number(command.input.ContinuationToken ?? '0');
      const keys = [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      const page = keys.slice(start, start + maxKeys);
      const truncated = start + maxKeys < keys.length;
      return {
        Contents: page.map((key) => ({
          Key: key,
          Size: objects.get(key)?.body.length ?? 0,
          LastModified: objects.get(key)?.lastModified,
        })),
        KeyCount: page.length,
        IsTruncated: truncated,
        ...(truncated ? { NextContinuationToken: String(start + maxKeys) } : {}),
      };
    }
    if (command instanceof DeleteObjectCommand) {
      objects.delete(required(command.input.Key, 'Key'));
      return {};
    }
    throw new TypeError('fake S3 does not answer this command');
  };

  const send = (command: unknown, options?: SendOptions): Promise<unknown> => {
    const name =
      typeof command === 'object' && command !== null ? command.constructor.name : 'unknown';
    calls.push(name);
    const failure = failures.get(name);
    if (failure !== undefined) {
      return Promise.reject(failure);
    }
    const signal = options?.abortSignal;
    if (signal?.aborted === true) {
      const reason: unknown = signal.reason;
      return Promise.reject(reason instanceof Error ? reason : new Error('aborted'));
    }
    try {
      return Promise.resolve(handle(command));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('fake S3 failure'));
    }
  };

  return {
    // test double: implements send() for the commands the backup uses
    client: { send } as unknown as S3Client,
    objects,
    calls,
    failOn: (commandName, error) => {
      failures.set(commandName, error ?? new Error('fake failure'));
    },
    headSize,
  };
}
