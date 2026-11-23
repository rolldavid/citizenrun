import { createHash, createPublicKey, generateKeyPair } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { seededRandom } from '@citizenrun/shared/testing';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { decryptFile, encryptFile, EnvelopeError, publicKeyFingerprint } from './envelope.ts';

const generate = promisify(generateKeyPair);

type Pair = { publicKey: string; privateKey: string };

let first: Pair = { publicKey: '', privateKey: '' };
let second: Pair = { publicKey: '', privateKey: '' };
let dir = '';

function rsaPair(): Promise<Pair> {
  return generate('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function seededBytes(length: number, seed: number): Buffer {
  const random = seededRandom(seed);
  const bytes = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(random() * 256);
  }
  return bytes;
}

async function encrypted(plain: Uint8Array, name = 'plain'): Promise<string> {
  const plainFile = join(dir, `${name}.dump`);
  const encFile = join(dir, `${name}.dump.enc`);
  await writeFile(plainFile, plain);
  await encryptFile(plainFile, encFile, first.publicKey);
  return encFile;
}

async function expectRefused(encFile: string, privateKey: string, message: string): Promise<void> {
  const out = join(dir, 'restored.dump');
  const failure = await decryptFile(encFile, out, privateKey).then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(EnvelopeError);
  expect(failure).toHaveProperty('message', message);
  expect(existsSync(out)).toBe(false);
  expect(existsSync(`${out}.partial`)).toBe(false);
}

async function flipByte(file: string, offset: number): Promise<void> {
  const bytes = await readFile(file);
  const index = offset < 0 ? bytes.length + offset : offset;
  bytes[index] = (bytes[index] ?? 0) ^ 0x01;
  await writeFile(file, bytes);
}

beforeAll(async () => {
  [first, second] = await Promise.all([rsaPair(), rsaPair()]);
}, 60_000);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'envelope-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('encryptFile and decryptFile', () => {
  it('round trip with a 4096-bit key pair', async () => {
    const plain = seededBytes(100_000, 1);
    const encFile = await encrypted(plain);
    const out = join(dir, 'restored.dump');
    await decryptFile(encFile, out, first.privateKey);
    expect((await readFile(out)).equals(plain)).toBe(true);
    expect(existsSync(`${out}.partial`)).toBe(false);
  });

  it('a flipped ciphertext byte fails decryption', async () => {
    const encFile = await encrypted(seededBytes(1000, 2));
    // The first ciphertext byte follows the 10-byte prefix, the 512-byte wrapped key and the IV.
    await flipByte(encFile, 10 + 512 + 12 + 500);
    await expectRefused(encFile, first.privateKey, 'authentication failed');
  });

  it('a flipped tag fails', async () => {
    const encFile = await encrypted(seededBytes(1000, 3));
    await flipByte(encFile, -1);
    await expectRefused(encFile, first.privateKey, 'authentication failed');
  });

  it('a flipped IV byte fails', async () => {
    const encFile = await encrypted(seededBytes(1000, 4));
    await flipByte(encFile, 10 + 512);
    await expectRefused(encFile, first.privateKey, 'authentication failed');
  });

  it('the header layout', async () => {
    const plainBytes = 4321;
    const encFile = await encrypted(seededBytes(plainBytes, 5));
    const bytes = await readFile(encFile);
    expect(bytes.subarray(0, 8).toString('ascii')).toBe('DBENV01\n');
    expect(bytes.readUInt16BE(8)).toBe(512);
    expect(bytes.length).toBe(10 + 512 + 12 + plainBytes + 16);
    expect((await stat(encFile)).mode & 0o777).toBe(0o600);
  });

  it('an empty file round-trips', async () => {
    const encFile = await encrypted(Buffer.alloc(0));
    expect((await stat(encFile)).size).toBe(550);
    const out = join(dir, 'restored.dump');
    await decryptFile(encFile, out, first.privateKey);
    expect((await readFile(out)).length).toBe(0);
  });

  it('a file longer than one read chunk round-trips', async () => {
    const plain = seededBytes(1024 * 1024 + 7, 6);
    const encFile = await encrypted(plain);
    const out = join(dir, 'restored.dump');
    await decryptFile(encFile, out, first.privateKey);
    expect((await readFile(out)).equals(plain)).toBe(true);
  });

  it('the wrong private key fails', async () => {
    const encFile = await encrypted(seededBytes(1000, 7));
    await expectRefused(encFile, second.privateKey, 'wrapped key does not decrypt');
  });

  it('a truncated or foreign file is refused', async () => {
    const short = join(dir, 'short.dump.enc');
    await writeFile(short, seededBytes(20, 8));
    await expectRefused(short, first.privateKey, 'truncated envelope');

    const foreign = join(dir, 'foreign.dump');
    await writeFile(foreign, Buffer.concat([Buffer.from('PGDMP', 'ascii'), seededBytes(2000, 9)]));
    await expectRefused(foreign, first.privateKey, 'not a dump envelope');

    const cut = await encrypted(seededBytes(1000, 10), 'cut');
    const bytes = await readFile(cut);
    await writeFile(cut, bytes.subarray(0, 10 + 512));
    await expectRefused(cut, first.privateKey, 'truncated envelope');
  });

  it('never overwrites an existing output of encryption', async () => {
    const plainFile = join(dir, 'plain.dump');
    const encFile = join(dir, 'taken.dump.enc');
    await writeFile(plainFile, seededBytes(100, 11));
    await writeFile(encFile, 'already here');
    await expect(encryptFile(plainFile, encFile, first.publicKey)).rejects.toThrow();
    expect(await readFile(encFile, 'utf8')).toBe('already here');
  });

  it('the encrypted file holds no plaintext marker', async () => {
    const plain = Buffer.from('OS_MARKER_backup_5d1e'.repeat(1000), 'ascii');
    const encFile = await encrypted(plain);
    const bytes = await readFile(encFile);
    expect(bytes.includes(Buffer.from('OS_MARKER_backup_5d1e', 'ascii'))).toBe(false);
    expect(bytes.includes(Buffer.from('OS_MARKER', 'ascii'))).toBe(false);
  });

  it('two encryptions of the same file differ', async () => {
    const plain = seededBytes(1000, 12);
    const a = await readFile(await encrypted(plain, 'a'));
    const b = await readFile(await encrypted(plain, 'b'));
    expect(a.equals(b)).toBe(false);
  });
});

describe('publicKeyFingerprint', () => {
  it('the fingerprint is the SHA-256 of the DER SubjectPublicKeyInfo', () => {
    const der = createPublicKey(first.publicKey).export({ type: 'spki', format: 'der' });
    const expected = createHash('sha256').update(der).digest('hex');
    const fingerprint = publicKeyFingerprint(first.publicKey);
    expect(fingerprint).toBe(expected);
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(publicKeyFingerprint(first.privateKey)).toBe(fingerprint);
    expect(publicKeyFingerprint(second.publicKey)).not.toBe(fingerprint);
  });
});
