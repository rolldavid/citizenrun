// Saved samples for parser tests: a real file under a `__fixtures__/` folder and its sidecar
// `<name>.meta.json` (TEST-pipeline-parsers; D-449). A file cut from a bulk original, or a
// redacted copy (TC-17), adds the original's SHA-256 and the list of transformations.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Hex64Schema, IsoInstantSchema } from '@citizenrun/shared';
import { z } from 'zod';

export const SidecarSchema = z
  .strictObject({
    url: z.url({ protocol: /^https$/ }),
    fetchedAt: IsoInstantSchema,
    sha256: Hex64Schema,
    contentType: z.string().min(1).max(200),
    originalSha256: Hex64Schema.optional(),
    transformations: z.array(z.string().min(1).max(200)).min(1).max(10).optional(),
  })
  .refine(
    (meta) => (meta.originalSha256 === undefined) === (meta.transformations === undefined),
    'originalSha256 and transformations appear together or not at all',
  );
export type Sidecar = z.infer<typeof SidecarSchema>;

/** The sidecar's path for a saved sample. */
export function sidecarPath(path: string): string {
  return `${path}.meta.json`;
}

/** A saved sample whose bytes do not hash to its sidecar's `sha256`. */
export class SavedSampleMismatchError extends Error {
  override readonly name = 'SavedSampleMismatchError';
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Reads a saved sample and its sidecar; throws when the sidecar is invalid or the hash differs. */
export async function readSavedSample(path: string): Promise<{ bytes: Uint8Array; meta: Sidecar }> {
  const [bytes, metaText] = await Promise.all([
    readFile(path),
    readFile(sidecarPath(path), 'utf8'),
  ]);
  const meta = SidecarSchema.parse(JSON.parse(metaText));
  const actual = sha256Hex(bytes);
  if (actual !== meta.sha256) {
    throw new SavedSampleMismatchError(`the saved sample ${path} does not match its sidecar`);
  }
  return { bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), meta };
}

/** Writes a saved sample and its sidecar, with the sidecar's `sha256` computed from `bytes`. */
export async function writeSavedSample(
  path: string,
  bytes: Uint8Array,
  meta: Omit<Sidecar, 'sha256'>,
): Promise<void> {
  const sidecar = SidecarSchema.parse({ ...meta, sha256: sha256Hex(bytes) });
  const ordered: Record<string, unknown> = {
    url: sidecar.url,
    fetchedAt: sidecar.fetchedAt,
    sha256: sidecar.sha256,
    contentType: sidecar.contentType,
  };
  if (sidecar.originalSha256 !== undefined) {
    ordered['originalSha256'] = sidecar.originalSha256;
    ordered['transformations'] = sidecar.transformations;
  }
  await writeFile(path, bytes);
  await writeFile(sidecarPath(path), `${JSON.stringify(ordered, null, 2)}\n`);
}
