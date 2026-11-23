import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
} from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, stat, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';

// The envelope's byte layout (OPS-backup-envelope, PC9-04).
export const ENVELOPE_MAGIC = Buffer.from('DBENV01\n', 'ascii');
export const DATA_KEY_BYTES = 32;
export const IV_BYTES = 12;
export const TAG_BYTES = 16;

const LENGTH_BYTES = 2;
const PREFIX_BYTES = ENVELOPE_MAGIC.length + LENGTH_BYTES;
const MAX_WRAPPED_KEY_BYTES = 0xffff;
const CIPHER = 'aes-256-gcm';
// RSA-OAEP with SHA-256; OpenSSL takes the OAEP digest for MGF1 when none is given separately.
const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' } as const;
const OUTPUT_MODE = 0o600;

/**
 * A file that is not an intact dump envelope for the given key. Its message is one of the static
 * texts `not a dump envelope`, `truncated envelope`, `wrapped key does not decrypt` and
 * `authentication failed`.
 */
export class EnvelopeError extends Error {
  override readonly name = 'EnvelopeError';
}

async function writeAll(handle: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
    offset += bytesWritten;
  }
}

async function readExactly(handle: FileHandle, length: number, position: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset);
    if (bytesRead === 0) {
      throw new EnvelopeError('truncated envelope');
    }
    offset += bytesRead;
  }
  return buffer;
}

async function discard(handle: FileHandle | null, file: string): Promise<void> {
  await handle?.close().catch(() => undefined);
  await unlink(file).catch(() => undefined);
}

/**
 * Encrypts `inFile` to `outFile` under a fresh AES-256-GCM data key wrapped with RSA-OAEP for
 * `publicKeyPem`, streaming so memory stays bounded. `outFile` must not exist; on failure it is
 * removed.
 */
export async function encryptFile(
  inFile: string,
  outFile: string,
  publicKeyPem: string,
): Promise<void> {
  const dataKey = randomBytes(DATA_KEY_BYTES);
  let out: FileHandle | null = null;
  let created = false;
  try {
    const wrapped = publicEncrypt({ key: publicKeyPem, ...OAEP }, dataKey);
    if (wrapped.length > MAX_WRAPPED_KEY_BYTES) {
      throw new RangeError('wrapped key too long');
    }
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(CIPHER, dataKey, iv, { authTagLength: TAG_BYTES });
    out = await open(outFile, 'wx', OUTPUT_MODE);
    created = true;
    const length = Buffer.alloc(LENGTH_BYTES);
    length.writeUInt16BE(wrapped.length, 0);
    await writeAll(out, ENVELOPE_MAGIC);
    await writeAll(out, length);
    await writeAll(out, wrapped);
    await writeAll(out, iv);
    for await (const chunk of createReadStream(inFile)) {
      if (!Buffer.isBuffer(chunk)) {
        throw new TypeError('expected bytes');
      }
      await writeAll(out, cipher.update(chunk));
    }
    await writeAll(out, cipher.final());
    await writeAll(out, cipher.getAuthTag());
    await out.close();
    out = null;
  } catch (error) {
    if (created) {
      await discard(out, outFile);
    }
    throw error;
  } finally {
    dataKey.fill(0);
  }
}

function unwrapKey(wrapped: Buffer, privateKeyPem: string): Buffer {
  let dataKey: Buffer;
  try {
    dataKey = privateDecrypt({ key: privateKeyPem, ...OAEP }, wrapped);
  } catch {
    throw new EnvelopeError('wrapped key does not decrypt');
  }
  if (dataKey.length !== DATA_KEY_BYTES) {
    dataKey.fill(0);
    throw new EnvelopeError('wrapped key does not decrypt');
  }
  return dataKey;
}

/**
 * Decrypts an envelope to `outFile`. The plaintext is written to `<outFile>.partial` and renamed
 * only once the GCM tag verifies, because GCM releases plaintext before it checks the tag; on any
 * failure the partial file is removed. Throws EnvelopeError for a foreign, truncated, wrongly keyed
 * or altered file.
 */
export async function decryptFile(
  inFile: string,
  outFile: string,
  privateKeyPem: string,
): Promise<void> {
  const { size } = await stat(inFile);
  if (size < PREFIX_BYTES + IV_BYTES + TAG_BYTES) {
    throw new EnvelopeError('truncated envelope');
  }
  let wrapped: Buffer;
  let iv: Buffer;
  let tag: Buffer;
  let headerLength: number;
  const input = await open(inFile, 'r');
  try {
    const prefix = await readExactly(input, PREFIX_BYTES, 0);
    if (!prefix.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)) {
      throw new EnvelopeError('not a dump envelope');
    }
    const wrappedLength = prefix.readUInt16BE(ENVELOPE_MAGIC.length);
    headerLength = PREFIX_BYTES + wrappedLength + IV_BYTES;
    if (headerLength + TAG_BYTES > size) {
      throw new EnvelopeError('truncated envelope');
    }
    wrapped = await readExactly(input, wrappedLength, PREFIX_BYTES);
    iv = await readExactly(input, IV_BYTES, PREFIX_BYTES + wrappedLength);
    tag = await readExactly(input, TAG_BYTES, size - TAG_BYTES);
  } finally {
    await input.close();
  }

  const dataKey = unwrapKey(wrapped, privateKeyPem);
  const partial = `${outFile}.partial`;
  let out: FileHandle | null = null;
  let created = false;
  try {
    const decipher = createDecipheriv(CIPHER, dataKey, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    out = await open(partial, 'wx', OUTPUT_MODE);
    created = true;
    if (size - TAG_BYTES > headerLength) {
      const ciphertext = createReadStream(inFile, {
        start: headerLength,
        end: size - TAG_BYTES - 1,
      });
      for await (const chunk of ciphertext) {
        if (!Buffer.isBuffer(chunk)) {
          throw new TypeError('expected bytes');
        }
        await writeAll(out, decipher.update(chunk));
      }
    }
    let last: Buffer;
    try {
      last = decipher.final();
    } catch {
      throw new EnvelopeError('authentication failed');
    }
    await writeAll(out, last);
    await out.close();
    out = null;
    await rename(partial, outFile);
  } catch (error) {
    if (created) {
      await discard(out, partial);
    }
    throw error;
  } finally {
    dataKey.fill(0);
  }
}

/** The lower-case hex SHA-256 of the key's DER-encoded SubjectPublicKeyInfo. */
export function publicKeyFingerprint(publicKeyPem: string): string {
  return createHash('sha256')
    .update(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }))
    .digest('hex');
}
