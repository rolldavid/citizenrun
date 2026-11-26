import type { PhotoRecord } from '@citizenrun/shared';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import type { FetchRequest } from '../../lib/fetch/types.ts';
import { createMemoryBucket } from '../../testing/memory-bucket.ts';
import { saved, s09Context, scriptFetcher, zzText } from '../../__fixtures__/s09/zz-s09.ts';
import type { Answer } from '../../__fixtures__/s09/zz-s09.ts';
import { portraitUrl } from '../../sources/congress-photos.ts';
import { ASSET_PREFIX, photosDetail, resolvePhotos, storePhoto } from './photos.ts';
import type { PhotoCandidate } from './photos.ts';

// The saved portrait's size, read once with sharp(bytes).metadata() when it was captured.
const PORTRAIT_WIDTH = 450;
const PORTRAIT_HEIGHT = 550;
const RESIZED_HEIGHT = Math.round((320 * PORTRAIT_HEIGHT) / PORTRAIT_WIDTH); // 391

const KEY = 'fixture-api-key-0123456789';
const BIOGUIDE = 'Z000001';
const COMMONS_PAGE =
  'https://commons.wikimedia.org/wiki/File:Fixture_Senator_official_portrait.jpg';
const THUMB =
  'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Fixture_Senator_official_portrait.jpg/640px-Fixture_Senator_official_portrait.jpg';
const CONGRESS_IMAGE = 'https://www.congress.gov/img/member/z000001_200.jpg';

let portrait: Uint8Array;
let pageImages: string;
let commons: string;
let member: string;

beforeAll(async () => {
  portrait = (await saved('portrait.jpg')).bytes;
  pageImages = await zzText('zz-wikipedia-pageimages.json');
  commons = await zzText('zz-commons-senate-portrait.json');
  member = await zzText('zz-congress-member.json');
});

type Overrides = Partial<
  Record<'step1' | 'congress' | 'congressImage' | 'thumb' | 'wikipedia' | 'commons', Answer>
>;

function run(overrides: Overrides = {}) {
  const bucket = createMemoryBucket();
  const json = (body: string): Answer => ({ body, contentType: 'application/json' });
  const image: Answer = { body: portrait, contentType: 'image/jpeg' };
  const fetcher = scriptFetcher(bucket, (req: FetchRequest) => {
    const url = new URL(req.url);
    if (req.url === portraitUrl(BIOGUIDE))
      return overrides.step1 ?? { kind: 'error', status: 404, reason: 'http_status' };
    if (url.hostname === 'api.congress.gov') return overrides.congress ?? json(member);
    if (req.url === CONGRESS_IMAGE) return overrides.congressImage ?? image;
    if (req.url === THUMB) return overrides.thumb ?? image;
    if (url.hostname === 'en.wikipedia.org') return overrides.wikipedia ?? json(pageImages);
    if (url.hostname === 'commons.wikimedia.org') return overrides.commons ?? json(commons);
    return undefined;
  });
  return { bucket, fetcher, ctx: s09Context(bucket, fetcher) };
}

const member1: PhotoCandidate = {
  personKey: `bioguide:${BIOGUIDE}`,
  bioguide: BIOGUIDE,
  wikipediaTitles: ['Fixture Senator'],
};
const legislator: PhotoCandidate = {
  personKey: 'openstates:ocd-person/00000000-0000-4000-8000-000000000009',
  bioguide: null,
  wikipediaTitles: ['Fixture Senator'],
};

async function assetBytes(
  bucket: ReturnType<typeof createMemoryBucket>,
  photo: PhotoRecord | null,
) {
  expect(photo?.asset.startsWith(ASSET_PREFIX)).toBe(true);
  const key = `assets/photos/${(photo?.asset ?? '').slice(ASSET_PREFIX.length)}`;
  const bytes = await bucket.getBytes(key);
  expect(bytes).not.toBeNull();
  return bytes ?? new Uint8Array();
}

describe('storePhoto', () => {
  it('a saved JPEG resizes to width 320 with the hand-checked height', async () => {
    const { bucket, fetcher, ctx } = run({ step1: { body: portrait, contentType: 'image/jpeg' } });
    const [outcome] = await resolvePhotos(ctx, [member1], new Map(), null);
    expect(outcome?.step).toBe('step1');
    expect(outcome?.photo).toMatchObject({
      width: 320,
      height: RESIZED_HEIGHT,
      source_url: portraitUrl(BIOGUIDE),
      author: 'U.S. Government Publishing Office',
      license: 'CC0-1.0',
      license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      credit_text: 'U.S. Government Publishing Office · CC0',
      modified: false,
      retrieved_at: '2026-11-26T15:00:00.000Z',
    });
    const meta = await sharp(await assetBytes(bucket, outcome?.photo ?? null)).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 320, 391]);
    expect(RESIZED_HEIGHT).toBe(391);
    expect(meta.exif).toBeUndefined();
    expect(fetcher.requests.map((r) => r.req.url)).toEqual([portraitUrl(BIOGUIDE)]);
  });

  it('applies the EXIF orientation before the metadata is stripped', async () => {
    const turned = await sharp(portrait).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect((await sharp(turned).metadata()).orientation).toBe(6);
    const { bucket, ctx } = run();
    const stored = await storePhoto(ctx, turned);
    expect(stored).toMatchObject({
      width: 320,
      height: Math.round((320 * PORTRAIT_WIDTH) / PORTRAIT_HEIGHT),
    });
    const meta = await sharp(
      (await bucket.getBytes(
        `assets/photos/${(stored?.asset ?? '').slice(ASSET_PREFIX.length)}`,
      )) ?? Buffer.alloc(0),
    ).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });

  it('never enlarges a small image and refuses bytes that do not decode', async () => {
    const small = await sharp(portrait).resize({ width: 100 }).jpeg().toBuffer();
    const { ctx } = run();
    expect(await storePhoto(ctx, small)).toMatchObject({ width: 100 });
    expect(await storePhoto(ctx, new TextEncoder().encode('not an image'))).toBeNull();
  });
});

describe('resolvePhotos', () => {
  it('step 2 is skipped without FEC_API_KEY', async () => {
    const { fetcher, ctx } = run();
    const [outcome] = await resolvePhotos(ctx, [member1], new Map(), null);
    expect(fetcher.requests.some((r) => new URL(r.req.url).hostname === 'api.congress.gov')).toBe(
      false,
    );
    expect(outcome?.step).toBe('step3');
    expect(outcome?.photo).toMatchObject({ source_url: COMMONS_PAGE, license: 'LicenseRef-PD' });
    expect(outcome?.rejected).toEqual(['missing']);
  });

  it('step 2 with a key and a federal attribution is accepted', async () => {
    const { fetcher, ctx } = run();
    const [outcome] = await resolvePhotos(ctx, [member1], new Map(), KEY);
    expect(outcome?.step).toBe('step2');
    expect(outcome?.photo).toMatchObject({
      source_url: 'https://www.congress.gov/member/fixture-member/Z000001',
      author: 'Courtesy U.S. Senate Historical Office',
      license: 'LicenseRef-PD-USGov',
      license_url: 'https://www.law.cornell.edu/uscode/text/17/105',
      credit_text: 'Courtesy U.S. Senate Historical Office · Public domain',
      width: 320,
    });
    const congress = fetcher.requests.find(
      (r) => new URL(r.req.url).hostname === 'api.congress.gov',
    );
    expect(congress?.req).toMatchObject({
      class: 'api',
      url: 'https://api.congress.gov/v3/member/Z000001?format=json',
    });
  });

  it('an absent attribution is credited to Congress.gov', async () => {
    const body = JSON.stringify({
      member: { directOrderName: 'Fixture Member', depiction: { imageUrl: CONGRESS_IMAGE } },
    });
    const { ctx } = run({ congress: { body, contentType: 'application/json' } });
    const [outcome] = await resolvePhotos(ctx, [member1], new Map(), KEY);
    expect(outcome?.photo).toMatchObject({
      author: 'Congress.gov',
      credit_text: 'Congress.gov · Public domain',
    });
  });

  it('a non-federal attribution is rejected', async () => {
    const body = member.replace(
      'Courtesy U.S. Senate Historical Office',
      'Image courtesy of the Member',
    );
    const { fetcher, ctx } = run({ congress: { body, contentType: 'application/json' } });
    const [outcome] = await resolvePhotos(ctx, [member1], new Map(), KEY);
    expect(outcome?.rejected).toEqual(['missing', 'attribution']);
    expect(outcome?.step).toBe('step3');
    expect(fetcher.requests.some((r) => r.req.url === CONGRESS_IMAGE)).toBe(false);
  });

  it('the key is sent only in X-Api-Key', async () => {
    const { fetcher, ctx } = run();
    await resolvePhotos(ctx, [member1], new Map(), KEY);
    const withKey = fetcher.requests.filter((r) =>
      JSON.stringify(r.req.headers ?? {}).includes(KEY),
    );
    expect(withKey).toHaveLength(1);
    expect(withKey[0]?.req.headers).toEqual({ 'X-Api-Key': KEY });
    expect(withKey[0]?.req.url.startsWith('https://api.congress.gov/')).toBe(true);
    for (const recorded of fetcher.requests) {
      expect(recorded.req.url).not.toContain(KEY);
    }
  });

  it('an unchanged Commons file reuses the previous photo without a download', async () => {
    const previous: PhotoRecord = {
      asset: `${ASSET_PREFIX}${'a'.repeat(64)}.jpg`,
      width: 320,
      height: 391,
      source_url: COMMONS_PAGE,
      author: 'United States Senate',
      license: 'LicenseRef-PD',
      license_url: 'https://commons.wikimedia.org/wiki/Commons:Licensing',
      credit_text: 'United States Senate · Public domain',
      modified: false,
      retrieved_at: '2026-10-01T00:00:00.000Z',
    };
    const { fetcher, ctx } = run();
    const [outcome] = await resolvePhotos(
      ctx,
      [legislator],
      new Map([[legislator.personKey, previous]]),
      null,
    );
    expect(outcome).toEqual({
      personKey: legislator.personKey,
      photo: previous,
      step: null,
      rejected: [],
    });
    expect(fetcher.requests.some((r) => r.req.url === THUMB)).toBe(false);
  });

  it('an unchanged step 1 portrait is kept with no request', async () => {
    const previous: PhotoRecord = {
      asset: `${ASSET_PREFIX}${'b'.repeat(64)}.jpg`,
      width: 320,
      height: 391,
      source_url: portraitUrl(BIOGUIDE),
      author: 'U.S. Government Publishing Office',
      license: 'CC0-1.0',
      license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
      credit_text: 'U.S. Government Publishing Office · CC0',
      modified: false,
      retrieved_at: '2026-10-01T00:00:00.000Z',
    };
    const { fetcher, ctx } = run();
    const [outcome] = await resolvePhotos(
      ctx,
      [member1],
      new Map([[member1.personKey, previous]]),
      null,
    );
    expect(outcome?.photo).toBe(previous);
    expect(fetcher.requests).toHaveLength(0);
  });

  it('a daily cap keeps the previous photo', async () => {
    const previous: PhotoRecord = {
      asset: `${ASSET_PREFIX}${'c'.repeat(64)}.jpg`,
      width: 320,
      height: 400,
      source_url: 'https://commons.wikimedia.org/wiki/File:Fixture_older_portrait.jpg',
      author: 'Fixture Photographer',
      license: 'CC-BY-4.0',
      license_url: 'https://creativecommons.org/licenses/by/4.0',
      credit_text: 'Fixture Photographer · CC BY 4.0',
      modified: false,
      retrieved_at: '2026-10-01T00:00:00.000Z',
    };
    const capped: Overrides = { thumb: { kind: 'disallowed', reason: 'daily_cap' } };
    const kept = run(capped);
    const [outcome] = await resolvePhotos(
      kept.ctx,
      [legislator],
      new Map([[legislator.personKey, previous]]),
      null,
    );
    expect(outcome).toEqual({
      personKey: legislator.personKey,
      photo: previous,
      step: null,
      rejected: ['daily_cap'],
    });
    const none = run(capped);
    const [first] = await resolvePhotos(none.ctx, [legislator], new Map(), null);
    expect(first?.photo).toBeNull();
  });

  it('a file missing from Commons or a refused licence gives no photo', async () => {
    const missing = JSON.stringify({
      query: {
        pages: [{ ns: 6, title: 'File:Fixture_Senator_official_portrait.jpg', missing: true }],
      },
    });
    const one = run({ commons: { body: missing, contentType: 'application/json' } });
    const [a] = await resolvePhotos(one.ctx, [legislator], new Map(), null);
    expect(a).toMatchObject({ photo: null, step: null, rejected: ['missing'] });
    const sa = commons.replace('"value": "pd"', '"value": "cc-by-sa-4.0"');
    const two = run({ commons: { body: sa, contentType: 'application/json' } });
    const [b] = await resolvePhotos(two.ctx, [legislator], new Map(), null);
    expect(b).toMatchObject({ photo: null, rejected: ['licence'] });
    expect(two.fetcher.requests.some((r) => r.req.url === THUMB)).toBe(false);
  });

  it('nothing is hotlinked', async () => {
    const { ctx } = run();
    const outcomes = await resolvePhotos(ctx, [member1, legislator], new Map(), KEY);
    expect(outcomes.map((o) => o.step)).toEqual(['step2', 'step3']);
    for (const outcome of outcomes) {
      expect(outcome.photo?.asset.startsWith('../../assets/photos/')).toBe(true);
      const values = Object.values(outcome.photo ?? {});
      for (const url of [
        THUMB,
        CONGRESS_IMAGE,
        'https://upload.wikimedia.org/wikipedia/commons/0/0f/Fixture_Senator_official_portrait.jpg',
      ]) {
        expect(values).not.toContain(url);
      }
    }
    expect(photosDetail(outcomes)).toBe('step1=0 step2=1 step3=1 reused=0 none=0 missing=1');
  });
});
