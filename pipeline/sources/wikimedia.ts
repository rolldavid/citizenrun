// English Wikipedia page images and Wikimedia Commons file metadata, and the licence gate of a
// Commons file (D-089, D-333). Every request is an `api`-class request through the fetcher, which
// sends the descriptive user agent Wikimedia requires.
import { SafeUrlSchema } from '@citizenrun/shared';
import type { PhotoRecord } from '@citizenrun/shared';
import { load } from 'cheerio';
import { z } from 'zod';
import type { RunContext } from '../lib/runner.ts';

export const SOURCE_IDS = ['wikipedia', 'wikimedia-commons'] as const;

/** Why a photo candidate was not used. */
export type PhotoRejectReason =
  | 'licence' // not on the allow-list of D-333
  | 'mime' // not a JPEG, PNG or WebP file
  | 'no_artist' // no author to credit
  | 'artist_too_long' // an author credit longer than the record holds
  | 'no_licence_url' // no licence link for a licence that needs one
  | 'no_source_url' // no safe link to the file's page
  | 'missing' // not a Commons file (for example an English Wikipedia fair-use file)
  | 'no_page_image' // the Wikipedia page has no lead image
  | 'attribution' // a Congress.gov portrait credited to a body that is not federal
  | 'decode' // the image did not decode
  | 'daily_cap' // the host's request count for the day is used up
  | 'fetch_failed'; // the request was refused or failed

/** The most titles one Wikimedia API request takes. */
export const TITLES_PER_REQUEST = 50;

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/** The licence link of a Commons `pd` file that gives no LicenseUrl: Commons' licensing page. */
export const COMMONS_LICENSING_URL = 'https://commons.wikimedia.org/wiki/Commons:Licensing';
export const CC0_URL = 'https://creativecommons.org/publicdomain/zero/1.0/';

type FetchJsonResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

/** One `api`-class GET whose body is JSON of `schema`; the reason of a refusal or failure otherwise. */
async function fetchJson<T>(
  ctx: RunContext,
  url: string,
  schema: z.ZodType<T>,
): Promise<FetchJsonResult<T>> {
  const result = await ctx.fetcher.fetch({ url, class: 'api' });
  if (result.kind !== 'ok') {
    return {
      ok: false,
      reason: result.kind === 'disallowed' || result.kind === 'error' ? result.reason : result.kind,
    };
  }
  const bytes = await ctx.bucket.getBytes(result.cacheKey);
  if (bytes === null) {
    return { ok: false, reason: 'not_cached' };
  }
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
  const parsed = schema.safeParse(json);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, reason: 'invalid_shape' };
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) {
    out.push(items.slice(at, at + size));
  }
  return out;
}

const RenameSchema = z.object({ from: z.string(), to: z.string() });

const QueryShape = <P extends z.ZodType>(page: P) =>
  z.object({
    query: z
      .object({
        normalized: z.array(RenameSchema).optional(),
        redirects: z.array(RenameSchema).optional(),
        pages: z.array(page).optional(),
      })
      .optional(),
  });

const WikipediaPageSchema = z.object({
  title: z.string(),
  missing: z.boolean().optional(),
  invalid: z.boolean().optional(),
  pageimage: z.string().optional(),
  pageprops: z.object({ wikibase_item: z.string().optional() }).optional(),
});
const WikipediaResponseSchema = QueryShape(WikipediaPageSchema);

/** The page title each requested title ends at, after the API's `normalized` and `redirects` lists. */
function resolveTitle(
  title: string,
  normalized: readonly { from: string; to: string }[],
  redirects: readonly { from: string; to: string }[],
): string {
  const named = normalized.find((entry) => entry.from === title)?.to ?? title;
  return redirects.find((entry) => entry.from === named)?.to ?? named;
}

const QID = /^Q\d+$/;

/**
 * The lead image file name and the Wikidata item of each title, 50 titles a request. A title the
 * API answered for is in the map (with nulls when the page is missing or has no image); a title
 * whose request was refused or failed is not.
 */
export async function wikipediaPageImages(
  ctx: RunContext,
  titles: readonly string[],
): Promise<ReadonlyMap<string, { pageImage: string | null; wikidataQid: string | null }>> {
  const out = new Map<string, { pageImage: string | null; wikidataQid: string | null }>();
  const distinct = [...new Set(titles)];
  for (const batch of batches(distinct, TITLES_PER_REQUEST)) {
    const url =
      `${WIKIPEDIA_API}?action=query&prop=pageprops|pageimages&piprop=name&redirects=1` +
      `&format=json&formatversion=2&titles=${encodeURIComponent(batch.join('|'))}`;
    const answer = await fetchJson(ctx, url, WikipediaResponseSchema);
    if (!answer.ok) {
      ctx.log.warn('wikipedia.batch_failed', { titles: batch.length, reason: answer.reason });
      continue;
    }
    const query = answer.value.query;
    const pages = new Map((query?.pages ?? []).map((page) => [page.title, page]));
    for (const title of batch) {
      const page = pages.get(resolveTitle(title, query?.normalized ?? [], query?.redirects ?? []));
      const usable = page !== undefined && page.missing !== true && page.invalid !== true;
      const qid = usable ? (page.pageprops?.wikibase_item ?? null) : null;
      out.set(title, {
        pageImage:
          usable && page.pageimage !== undefined && page.pageimage !== '' ? page.pageimage : null,
        wikidataQid: qid !== null && QID.test(qid) ? qid : null,
      });
    }
  }
  return out;
}

export type CommonsInfo = {
  url: string;
  thumbUrl: string | null;
  mime: string;
  width: number;
  height: number;
  descriptionUrl: string;
  license: string | null;
  licenseShortName: string | null;
  licenseUrl: string | null;
  artistHtml: string | null;
};

const ExtValueSchema = z.object({ value: z.unknown() }).optional();
const ImageInfoSchema = z.object({
  url: z.string(),
  thumburl: z.string().optional(),
  mime: z.string(),
  width: z.number(),
  height: z.number(),
  descriptionurl: z.string(),
  extmetadata: z
    .object({
      License: ExtValueSchema,
      LicenseShortName: ExtValueSchema,
      LicenseUrl: ExtValueSchema,
      Artist: ExtValueSchema,
    })
    .optional(),
});
const CommonsPageSchema = z.object({
  title: z.string(),
  missing: z.boolean().optional(),
  invalid: z.boolean().optional(),
  imageinfo: z.array(ImageInfoSchema).optional(),
});
const CommonsResponseSchema = QueryShape(CommonsPageSchema);

function extString(entry: { value: unknown } | undefined): string | null {
  return typeof entry?.value === 'string' && entry.value.trim() !== '' ? entry.value : null;
}

/**
 * The Commons metadata of each file name (without `File:`), 50 a request. A page Commons does not
 * hold is `'missing'`; a name whose request was refused or failed is not in the map.
 */
export async function commonsFileInfo(
  ctx: RunContext,
  files: readonly string[],
): Promise<ReadonlyMap<string, CommonsInfo | 'missing'>> {
  const out = new Map<string, CommonsInfo | 'missing'>();
  const distinct = [...new Set(files)];
  for (const batch of batches(distinct, TITLES_PER_REQUEST)) {
    const titles = batch.map((file) => `File:${file}`);
    const url =
      `${COMMONS_API}?action=query&prop=imageinfo&iiprop=url|extmetadata|size|mime&iiurlwidth=640` +
      `&format=json&formatversion=2&titles=${encodeURIComponent(titles.join('|'))}`;
    const answer = await fetchJson(ctx, url, CommonsResponseSchema);
    if (!answer.ok) {
      ctx.log.warn('commons.batch_failed', { files: batch.length, reason: answer.reason });
      continue;
    }
    const query = answer.value.query;
    const pages = new Map((query?.pages ?? []).map((page) => [page.title, page]));
    batch.forEach((file, i) => {
      const page = pages.get(
        resolveTitle(titles[i] ?? '', query?.normalized ?? [], query?.redirects ?? []),
      );
      const info = page?.imageinfo?.[0];
      if (
        page === undefined ||
        page.missing === true ||
        page.invalid === true ||
        info === undefined
      ) {
        out.set(file, 'missing');
        return;
      }
      const meta = info.extmetadata;
      out.set(file, {
        url: info.url,
        thumbUrl: info.thumburl ?? null,
        mime: info.mime,
        width: info.width,
        height: info.height,
        descriptionUrl: info.descriptionurl,
        license: extString(meta?.License),
        licenseShortName: extString(meta?.LicenseShortName),
        licenseUrl: extString(meta?.LicenseUrl),
        artistHtml: extString(meta?.Artist),
      });
    });
  }
  return out;
}

const LICENCES: Readonly<Record<string, PhotoRecord['license']>> = {
  pd: 'LicenseRef-PD',
  cc0: 'CC0-1.0',
  'cc-by-1.0': 'CC-BY-1.0',
  'cc-by-2.0': 'CC-BY-2.0',
  'cc-by-2.5': 'CC-BY-2.5',
  'cc-by-3.0': 'CC-BY-3.0',
  'cc-by-4.0': 'CC-BY-4.0',
};
const MIMES: ReadonlySet<string> = new Set(['image/jpeg', 'image/png', 'image/webp']);
const AUTHOR_MAX = 300;

/** The text of an HTML fragment, whitespace collapsed; never markup. */
export function htmlText(html: string): string {
  return load(`<div>${html}</div>`, null, false).root().text().replace(/\s+/g, ' ').trim();
}

function safeUrl(value: string | null): string | null {
  return value !== null && SafeUrlSchema.safeParse(value).success ? value : null;
}

export type PhotoRecordBase = Omit<PhotoRecord, 'asset' | 'width' | 'height' | 'retrieved_at'>;

/** The D-333 record of a Commons file, or why the file is refused. The allow-list is exact. */
export function commonsRecord(
  info: CommonsInfo,
): { ok: true; record: PhotoRecordBase } | { ok: false; reason: PhotoRejectReason } {
  const code = (info.license ?? '').trim().toLowerCase();
  const license = Object.hasOwn(LICENCES, code) ? LICENCES[code] : undefined;
  if (license === undefined) {
    return { ok: false, reason: 'licence' };
  }
  if (!MIMES.has(info.mime.toLowerCase())) {
    return { ok: false, reason: 'mime' };
  }
  const author = info.artistHtml === null ? '' : htmlText(info.artistHtml);
  if (author === '') {
    return { ok: false, reason: 'no_artist' };
  }
  if (author.length > AUTHOR_MAX) {
    return { ok: false, reason: 'artist_too_long' };
  }
  let licenseUrl: string | null;
  if (code === 'cc0') {
    licenseUrl = CC0_URL;
  } else if (code === 'pd') {
    licenseUrl = safeUrl(info.licenseUrl) ?? COMMONS_LICENSING_URL;
  } else {
    licenseUrl = safeUrl(info.licenseUrl);
  }
  if (licenseUrl === null) {
    return { ok: false, reason: 'no_licence_url' };
  }
  const sourceUrl = safeUrl(info.descriptionUrl);
  if (sourceUrl === null) {
    return { ok: false, reason: 'no_source_url' };
  }
  const shortName = info.licenseShortName === null ? null : htmlText(info.licenseShortName) || null;
  const licenceName =
    shortName ?? (code === 'cc0' ? 'CC0' : code === 'pd' ? 'Public domain' : license);
  return {
    ok: true,
    record: {
      source_url: sourceUrl,
      author,
      license,
      license_url: licenseUrl,
      credit_text: `${author} · ${licenceName}`,
      modified: false,
    },
  };
}

/** The page title of an English Wikipedia article URL, or null for any other URL. */
export function wikipediaTitle(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== 'en.wikipedia.org' || !parsed.pathname.startsWith('/wiki/')) {
    return null;
  }
  const raw = parsed.pathname.slice('/wiki/'.length);
  if (raw === '') {
    return null;
  }
  let title: string;
  try {
    title = decodeURIComponent(raw);
  } catch {
    return null;
  }
  title = title.replace(/_/g, ' ').trim();
  return title === '' || title.includes('|') ? null : title;
}
