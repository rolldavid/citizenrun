import { sql } from 'drizzle-orm';
import type { Db } from '../client.ts';
import { assetFormatOk } from './assets.ts';
import type { MediaAssetWriter } from './assets.ts';
import type { AssetRef } from './gates.ts';
import type { BundleReader } from './reader.ts';

// The asset copy of PIPE-loader-assets (P8-55): each referenced asset that is new to the
// `media` bucket is read, checked and written under its content-hash key. Runs after the holds and
// before the upsert transaction, never inside a transaction (no bucket call in a transaction).

/** Where a bundle photo lives in `media` and its size. */
export type PhotoPlacement = { key: string; width: number; height: number };

/** An asset could not be copied; the message is '<kind> <sha256>' and names no content. */
export class BundleAssetError extends Error {
  override readonly name = 'BundleAssetError';

  constructor(kind: 'photo' | 'form', sha256: string) {
    super(`${kind} ${sha256}`);
  }
}

async function storedSizes(
  db: Db,
  keys: readonly string[],
): Promise<Map<string, { width: number; height: number }>> {
  const sizes = new Map<string, { width: number; height: number }>();
  if (keys.length === 0) {
    return sizes;
  }
  // index: people_photo_key
  const rows = await db.execute<{ photo_key: string; photo_width: number; photo_height: number }>(
    sql`select distinct on (photo_key) photo_key, photo_width, photo_height
        from people
        where photo_key = any(${sql.param(keys)}::text[])
          and photo_width is not null and photo_height is not null`,
    'objects',
  );
  for (const row of rows) {
    sizes.set(row.photo_key, { width: row.photo_width, height: row.photo_height });
  }
  return sizes;
}

async function copyOne(
  asset: AssetRef,
  reader: BundleReader,
  media: MediaAssetWriter,
  known: ReadonlyMap<string, { width: number; height: number }>,
): Promise<PhotoPlacement | null> {
  if (asset.kind === 'form') {
    if (!asset.present) {
      const bytes = await reader.bytes(asset.path, { sha256: asset.sha256, bytes: asset.bytes });
      if (!assetFormatOk('form', bytes)) {
        throw new BundleAssetError('form', asset.sha256);
      }
      await media.store.put(asset.mediaKey, bytes, 'application/pdf');
    }
    return null;
  }
  if (asset.present) {
    const size =
      known.get(asset.mediaKey) ??
      (await media.measurePhoto(await media.store.get(asset.mediaKey)));
    return { key: asset.mediaKey, width: size.width, height: size.height };
  }
  const bytes = await reader.bytes(asset.path, { sha256: asset.sha256, bytes: asset.bytes });
  if (!assetFormatOk('photo', bytes)) {
    throw new BundleAssetError('photo', asset.sha256);
  }
  const encoded = await media.reencodePhoto(bytes);
  await media.store.put(asset.mediaKey, encoded.jpeg, 'image/jpeg');
  // The stored image's own size: the re-encoded file's (PIPE-loader-assets).
  return { key: asset.mediaKey, width: encoded.width, height: encoded.height };
}

/**
 * Copies every asset of `assets` that is not yet in `media`, one at a time, and returns each
 * photo's placement by its sha256. Any failure throws BundleAssetError. Idempotent: the key is the
 * content hash, and a key already present is never written again.
 */
export async function copyAssets(
  db: Db,
  reader: BundleReader,
  assets: readonly AssetRef[],
  media: MediaAssetWriter,
): Promise<Map<string, PhotoPlacement>> {
  const known = await storedSizes(
    db,
    assets
      .filter((asset) => asset.kind === 'photo' && asset.present)
      .map((asset) => asset.mediaKey),
  );
  const placements = new Map<string, PhotoPlacement>();
  for (const asset of assets) {
    let placement: PhotoPlacement | null;
    try {
      placement = await copyOne(asset, reader, media, known);
    } catch (error) {
      if (error instanceof BundleAssetError) {
        throw error;
      }
      throw new BundleAssetError(asset.kind, asset.sha256);
    }
    if (placement !== null) {
      placements.set(asset.sha256, placement);
    }
  }
  return placements;
}
