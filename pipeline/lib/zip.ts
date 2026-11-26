import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import type { Entry, ZipFile } from 'yauzl';

/** An entry whose name would leave the folder it is extracted into (zip-slip). */
export class ZipEntryNameError extends Error {
  override readonly name = 'ZipEntryNameError';

  constructor(entryName: string) {
    super(`refused zip entry name ${JSON.stringify(entryName)}`);
  }
}

/** The archive has no entry of the name asked for. */
export class ZipEntryMissingError extends Error {
  override readonly name = 'ZipEntryMissingError';

  constructor(entryName: string) {
    super(`the zip has no entry ${JSON.stringify(entryName)}`);
  }
}

const TEMP_FOLDER = 'citizenrun-pipeline';

/**
 * The entry's name, decoded here rather than by the library so that a refused name raises this
 * module's error: a name containing `..`, starting with `/`, or that the library calls absolute
 * or invalid.
 */
function entryName(entry: Entry): string {
  const name = yauzl.getFileNameLowLevel(
    entry.generalPurposeBitFlag,
    entry.fileNameRaw,
    entry.extraFields,
    false,
  );
  if (name.includes('..') || name.startsWith('/') || yauzl.validateFileName(name) !== null) {
    throw new ZipEntryNameError(name);
  }
  return name;
}

/**
 * Walks the entries in order, calling `visit` for each until it returns true. Resolves with the
 * entry `visit` accepted, or null at the end of the archive. The archive is closed in both cases.
 */
async function walk(
  path: string,
  visit: (name: string, entry: Entry) => boolean,
): Promise<{ zip: ZipFile; entry: Entry } | null> {
  const zip = await yauzl.openPromise(path, {
    lazyEntries: true,
    autoClose: true,
    decodeStrings: false,
  });
  return await new Promise((resolvePromise, reject) => {
    const fail = (error: unknown): void => {
      zip.close();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    zip.on('error', fail);
    zip.on('end', () => {
      resolvePromise(null);
    });
    zip.on('entry', (entry: Entry) => {
      try {
        if (visit(entryName(entry), entry)) {
          resolvePromise({ zip, entry });
          return;
        }
        zip.readEntry();
      } catch (error) {
        fail(error);
      }
    });
    zip.readEntry();
  });
}

/** Every entry of the archive at `path`, with its uncompressed size. */
export async function listZip(path: string): Promise<readonly { name: string; size: number }[]> {
  const entries: { name: string; size: number }[] = [];
  await walk(path, (name, entry) => {
    entries.push({ name, size: entry.uncompressedSize });
    return false;
  });
  return entries;
}

/** The uncompressed bytes of the first entry named `name`. */
export async function openZipEntry(path: string, name: string): Promise<Readable> {
  const found = await walk(path, (entryNameSeen) => entryNameSeen === name);
  if (found === null) {
    throw new ZipEntryMissingError(name);
  }
  try {
    return await found.zip.openReadStreamPromise(found.entry);
  } finally {
    // The open stream keeps the file open until it ends; nothing more is read from the archive.
    found.zip.close();
  }
}

/**
 * Copies `body` to a new file under the system's temporary folder, in `citizenrun-pipeline/`, for
 * readers that need random access. `suffix` is the file's ending, such as `.zip`.
 */
export async function toTempFile(
  body: Readable,
  suffix: string,
): Promise<{ path: string; remove(): Promise<void> }> {
  if (!/^[A-Za-z0-9._-]*$/.test(suffix)) {
    throw new TypeError(
      'a temporary file suffix holds only letters, digits, dot, dash and underscore',
    );
  }
  const folder = join(tmpdir(), TEMP_FOLDER);
  await mkdir(folder, { recursive: true });
  const path = join(folder, `${randomUUID()}${suffix}`);
  const remove = async (): Promise<void> => {
    await rm(path, { force: true });
  };
  try {
    await pipeline(body, createWriteStream(path, { flags: 'wx' }));
  } catch (error) {
    await remove();
    throw error;
  }
  return { path, remove };
}
