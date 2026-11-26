// The photo order of PIPE-people-photos (D-314, D-333): members of Congress try the GPO portrait,
// then Congress.gov (only with the key), then Commons through Wikipedia; everyone else Commons
// through Wikipedia. Every accepted photo carries the full D-333 record, is resized to 320 wide
// and stored once under assets/photos/<sha256>.jpg. Nothing is hotlinked.
import { createHash } from 'node:crypto';
import { PhotoRecordSchema } from '@citizenrun/shared';
import type { PhotoRecord } from '@citizenrun/shared';
import sharp from 'sharp';
import type { OutputInfo } from 'sharp';
import { bucketKeys } from '../../lib/bucket.ts';
import type { RunContext } from '../../lib/runner.ts';
import { congressGovStep2, portraitStep1, portraitUrl } from '../../sources/congress-photos.ts';
import type { CongressPhoto } from '../../sources/congress-photos.ts';
import { commonsFileInfo, commonsRecord, wikipediaPageImages } from '../../sources/wikimedia.ts';
import type { CommonsInfo, PhotoRecordBase, PhotoRejectReason } from '../../sources/wikimedia.ts';

export type { PhotoRejectReason } from '../../sources/wikimedia.ts';

export type PhotoStep = 'step1' | 'step2' | 'step3';
export type PhotoCandidate = {
  readonly personKey: string;
  readonly bioguide: string | null;
  readonly wikipediaTitles: readonly string[];
};
/**
 * `step` names the step that gave a newly stored photo; a photo kept from the previous output
 * (unchanged, or kept because a request could not be made) has `step` null.
 */
export type PhotoOutcome = {
  readonly personKey: string;
  readonly photo: PhotoRecord | null;
  readonly step: PhotoStep | null;
  readonly rejected: readonly PhotoRejectReason[];
};

export const PHOTO_WIDTH = 320;
const JPEG_QUALITY = 85;
/** The prefix of every record's `asset`, relative to a bundle folder (B-people). */
export const ASSET_PREFIX = '../../assets/photos/';

/** A failure that says nothing about the photo: the previous one is kept when there is one. */
const INCOMPLETE: ReadonlySet<PhotoRejectReason> = new Set(['daily_cap', 'fetch_failed']);

type Stored = { asset: string; width: number; height: number };

/**
 * Decodes, applies the EXIF orientation, resizes to 320 wide without enlarging or cropping and
 * writes JPEG quality 85 with no metadata; stores it once under its SHA-256. Null when it does not
 * decode.
 */
export async function storePhoto(ctx: RunContext, bytes: Uint8Array): Promise<Stored | null> {
  let output: { data: Buffer; info: OutputInfo };
  try {
    output = await sharp(bytes, { failOn: 'warning' })
      .rotate()
      .resize({ width: PHOTO_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });
  } catch {
    return null;
  }
  const sha256 = createHash('sha256').update(output.data).digest('hex');
  const key = bucketKeys.asset('photos', sha256, 'jpg');
  if ((await ctx.bucket.head(key)) === null) {
    await ctx.bucket.putBytes(key, output.data, 'image/jpeg');
  }
  return {
    asset: `${ASSET_PREFIX}${sha256}.jpg`,
    width: output.info.width,
    height: output.info.height,
  };
}

/** The reason a request result gives a photo candidate. */
function refusal(result: {
  kind: string;
  reason?: string;
  status?: number | null;
}): PhotoRejectReason {
  if (result.kind === 'disallowed' && result.reason === 'daily_cap') {
    return 'daily_cap';
  }
  if (result.kind === 'error' && (result.status === 404 || result.status === 410)) {
    return 'missing';
  }
  return 'fetch_failed';
}

/** The image body at `url` (an `api`-class request), or why there is none. */
async function fetchImage(
  ctx: RunContext,
  url: string,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: PhotoRejectReason }> {
  const result = await ctx.fetcher.fetch({ url, class: 'api' });
  if (result.kind !== 'ok') {
    return { ok: false, reason: refusal(result) };
  }
  const bytes = await ctx.bucket.getBytes(result.cacheKey);
  return bytes === null ? { ok: false, reason: 'fetch_failed' } : { ok: true, bytes };
}

function sameSource(
  previous: PhotoRecord | null,
  record: { source_url: string; license: string },
): boolean {
  return (
    previous !== null &&
    previous.source_url === record.source_url &&
    previous.license === record.license
  );
}

type Work = {
  readonly candidate: PhotoCandidate;
  readonly previous: PhotoRecord | null;
  readonly rejected: PhotoRejectReason[];
  outcome: PhotoOutcome | null;
};

function finish(work: Work, photo: PhotoRecord | null, step: PhotoStep | null): void {
  work.outcome = { personKey: work.candidate.personKey, photo, step, rejected: [...work.rejected] };
}

function accept(ctx: RunContext, base: PhotoRecordBase, stored: Stored): PhotoRecord {
  return PhotoRecordSchema.parse({
    ...base,
    asset: stored.asset,
    width: stored.width,
    height: stored.height,
    retrieved_at: ctx.now.toISOString(),
  });
}

/** Stores the bytes as the work's photo from `step`; false (with `decode`) when they do not decode. */
async function storeAs(
  ctx: RunContext,
  work: Work,
  base: PhotoRecordBase,
  bytes: Uint8Array,
  step: PhotoStep,
): Promise<boolean> {
  const stored = await storePhoto(ctx, bytes);
  if (stored === null) {
    work.rejected.push('decode');
    return false;
  }
  finish(work, accept(ctx, base, stored), step);
  return true;
}

/** A found Congress photo stored, or the reason it was not; true when the work is finished. */
async function congressStep(
  ctx: RunContext,
  work: Work,
  found: CongressPhoto,
  step: 'step1' | 'step2',
): Promise<boolean> {
  if (!found.ok) {
    work.rejected.push(found.reason);
    return false;
  }
  if ('cacheKey' in found) {
    const bytes = await ctx.bucket.getBytes(found.cacheKey);
    if (bytes === null) {
      work.rejected.push('fetch_failed');
      return false;
    }
    return storeAs(ctx, work, found.record, bytes, step);
  }
  if (sameSource(work.previous, found.record)) {
    finish(work, work.previous, null);
    return true;
  }
  const image = await fetchImage(ctx, found.imageUrl);
  if (!image.ok) {
    work.rejected.push(image.reason);
    return false;
  }
  return storeAs(ctx, work, found.record, image.bytes, step);
}

/**
 * The photo of each candidate, in candidate order. `previous` is each person's photo in this
 * stage's last good output: an unchanged source is kept with no download, and a candidate whose
 * requests could not be made (the day's cap, a refusal, a failure) keeps it too.
 */
export async function resolvePhotos(
  ctx: RunContext,
  candidates: readonly PhotoCandidate[],
  previous: ReadonlyMap<string, PhotoRecord>,
  fecApiKey: string | null,
): Promise<readonly PhotoOutcome[]> {
  const works: Work[] = candidates.map((candidate) => ({
    candidate,
    previous: previous.get(candidate.personKey) ?? null,
    rejected: [],
    outcome: null,
  }));

  // Members of Congress: steps 1 and 2, one person at a time.
  for (const work of works) {
    const bioguide = work.candidate.bioguide;
    if (bioguide === null) {
      continue;
    }
    if (sameSource(work.previous, { source_url: portraitUrl(bioguide), license: 'CC0-1.0' })) {
      finish(work, work.previous, null);
      continue;
    }
    if (await congressStep(ctx, work, await portraitStep1(ctx, bioguide), 'step1')) {
      continue;
    }
    if (fecApiKey !== null) {
      await congressStep(ctx, work, await congressGovStep2(ctx, bioguide, fecApiKey), 'step2');
    }
  }

  // Step 3 (and the only step for everyone else): Commons through the Wikipedia page image.
  const open = works.filter((work) => work.outcome === null);
  const titles = open.flatMap((work) => work.candidate.wikipediaTitles);
  const pages: ReadonlyMap<string, { pageImage: string | null }> =
    titles.length === 0 ? new Map() : await wikipediaPageImages(ctx, titles);
  const fileOf = new Map<Work, string>();
  for (const work of open) {
    let unknown = false;
    for (const title of work.candidate.wikipediaTitles) {
      const page = pages.get(title);
      if (page === undefined) {
        unknown = true;
        continue;
      }
      if (page.pageImage !== null) {
        fileOf.set(work, page.pageImage);
        break;
      }
    }
    if (!fileOf.has(work) && work.candidate.wikipediaTitles.length > 0) {
      work.rejected.push(unknown ? 'fetch_failed' : 'no_page_image');
    }
  }
  const files = [...new Set(fileOf.values())];
  const infos: ReadonlyMap<string, CommonsInfo | 'missing'> =
    files.length === 0 ? new Map() : await commonsFileInfo(ctx, files);
  for (const [work, file] of fileOf) {
    const info = infos.get(file);
    if (info === undefined) {
      work.rejected.push('fetch_failed');
      continue;
    }
    if (info === 'missing') {
      work.rejected.push('missing');
      continue;
    }
    const checked = commonsRecord(info);
    if (!checked.ok) {
      work.rejected.push(checked.reason);
      continue;
    }
    if (sameSource(work.previous, checked.record)) {
      finish(work, work.previous, null);
      continue;
    }
    const image = await fetchImage(ctx, info.thumbUrl ?? info.url);
    if (!image.ok) {
      work.rejected.push(image.reason);
      continue;
    }
    await storeAs(ctx, work, checked.record, image.bytes, 'step3');
  }

  return works.map((work) => {
    if (work.outcome !== null) {
      return work.outcome;
    }
    const keep = work.previous !== null && work.rejected.some((reason) => INCOMPLETE.has(reason));
    return {
      personKey: work.candidate.personKey,
      photo: keep ? work.previous : null,
      step: null,
      rejected: [...work.rejected],
    };
  });
}

/** The `photos` check's detail: the step counts, then each reject reason with its count. */
export function photosDetail(outcomes: readonly PhotoOutcome[]): string {
  const counts = { step1: 0, step2: 0, step3: 0, reused: 0, none: 0 };
  const reasons = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.photo === null) {
      counts.none += 1;
    } else if (outcome.step === null) {
      counts.reused += 1;
    } else {
      counts[outcome.step] += 1;
    }
    for (const reason of outcome.rejected) {
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }
  const parts = Object.entries(counts).map(([name, n]) => `${name}=${String(n)}`);
  for (const [reason, n] of [...reasons].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    parts.push(`${reason}=${String(n)}`);
  }
  return parts.join(' ');
}
