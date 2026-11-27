import { describe, expect, it } from 'vitest';
import { createMemoryBucket } from '../testing/memory-bucket.ts';
import { s09Context, saved, scriptFetcher, zzText } from '../__fixtures__/s09/zz-s09.ts';
import {
  CC0_URL,
  COMMONS_LICENSING_URL,
  commonsFileInfo,
  commonsRecord,
  htmlText,
  wikipediaPageImages,
  wikipediaTitle,
} from './wikimedia.ts';
import type { CommonsInfo } from './wikimedia.ts';

const FILE = 'Fixture_Senator_official_portrait.jpg';
// The page image of the saved Wikipedia response, and the file of the saved Commons response.
const SAVED_FILE = 'Sen._Thom_Tillis_(R-NC),_Official_Portrait,_117th_Congress_(cropped).jpg';

async function savedInfo(): Promise<CommonsInfo> {
  const body = (await saved('commons-senate-portrait.json')).bytes;
  const bucket = createMemoryBucket();
  const fetcher = scriptFetcher(bucket, (req) =>
    req.url.startsWith('https://commons.wikimedia.org/')
      ? { body, contentType: 'application/json' }
      : undefined,
  );
  const infos = await commonsFileInfo(s09Context(bucket, fetcher), [SAVED_FILE]);
  const info = infos.get(SAVED_FILE);
  if (info === undefined || info === 'missing') {
    throw new Error('the saved response gives no file');
  }
  return info;
}

describe('commonsRecord', () => {
  it('a public-domain Senate portrait passes', async () => {
    const result = commonsRecord(await savedInfo());
    expect(result).toEqual({
      ok: true,
      record: {
        source_url: `https://commons.wikimedia.org/wiki/File:${SAVED_FILE}`,
        author: 'United States Senate',
        license: 'LicenseRef-PD',
        license_url: COMMONS_LICENSING_URL,
        credit_text: 'United States Senate · Public domain',
        modified: false,
      },
    });
  });

  it('cc-by-sa-4.0 is rejected', async () => {
    const info = {
      ...(await savedInfo()),
      license: 'cc-by-sa-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
    };
    expect(commonsRecord(info)).toEqual({ ok: false, reason: 'licence' });
  });

  it('a record missing Artist is rejected', async () => {
    expect(commonsRecord({ ...(await savedInfo()), artistHtml: null })).toEqual({
      ok: false,
      reason: 'no_artist',
    });
    expect(commonsRecord({ ...(await savedInfo()), artistHtml: '<span> </span>' })).toEqual({
      ok: false,
      reason: 'no_artist',
    });
  });

  it('cc-by-nc and cc-by-nd are rejected', async () => {
    const info = await savedInfo();
    for (const license of [
      'cc-by-nc-4.0',
      'cc-by-nd-4.0',
      'cc-by-nc-sa-3.0',
      'fair use',
      'CC-BY-SA-3.0',
    ]) {
      expect(
        commonsRecord({ ...info, license, licenseUrl: 'https://creativecommons.org/' }),
      ).toEqual({
        ok: false,
        reason: 'licence',
      });
    }
  });

  it('cc0 gets the CC0 licence URL', async () => {
    const result = commonsRecord({
      ...(await savedInfo()),
      license: 'cc0',
      licenseShortName: null,
      licenseUrl: null,
    });
    expect(result).toMatchObject({
      ok: true,
      record: {
        license: 'CC0-1.0',
        license_url: CC0_URL,
        credit_text: 'United States Senate · CC0',
      },
    });
  });

  it('a pd file with no LicenseUrl gets the licensing page', async () => {
    const info = await savedInfo();
    expect(info.licenseUrl).toBeNull();
    expect(commonsRecord(info)).toMatchObject({
      ok: true,
      record: { license_url: COMMONS_LICENSING_URL },
    });
  });

  it('a cc-by file takes its LicenseUrl and short name, and needs the URL', async () => {
    const info = {
      ...(await savedInfo()),
      license: 'cc-by-3.0',
      licenseShortName: 'CC BY 3.0',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0',
    };
    expect(commonsRecord(info)).toMatchObject({
      ok: true,
      record: {
        license: 'CC-BY-3.0',
        license_url: 'https://creativecommons.org/licenses/by/3.0',
        credit_text: 'United States Senate · CC BY 3.0',
      },
    });
    expect(commonsRecord({ ...info, licenseUrl: null })).toEqual({
      ok: false,
      reason: 'no_licence_url',
    });
  });

  it('a file that is not a JPEG, PNG or WebP is rejected', async () => {
    expect(commonsRecord({ ...(await savedInfo()), mime: 'image/svg+xml' })).toEqual({
      ok: false,
      reason: 'mime',
    });
  });

  it('strips the markup of the Artist value', () => {
    expect(htmlText('<a href="https://example.test">Fixture\n  <b>Photographer</b></a>')).toBe(
      'Fixture Photographer',
    );
  });
});

describe('commonsFileInfo', () => {
  it('a file missing from Commons is rejected', async () => {
    const bucket = createMemoryBucket();
    const body = JSON.stringify({
      batchcomplete: true,
      query: { pages: [{ ns: 6, title: 'File:Fixture fair use.jpg', missing: true }] },
    });
    const fetcher = scriptFetcher(bucket, () => ({ body, contentType: 'application/json' }));
    const infos = await commonsFileInfo(s09Context(bucket, fetcher), ['Fixture fair use.jpg']);
    expect(infos.get('Fixture fair use.jpg')).toBe('missing');
  });

  it('reads the saved response through the normalised title', async () => {
    const info = await savedInfo();
    expect(info).toMatchObject({
      mime: 'image/jpeg',
      width: 2834,
      height: 3589,
      license: 'pd',
      licenseShortName: 'Public domain',
      licenseUrl: null,
      artistHtml: 'United States Senate',
      descriptionUrl: `https://commons.wikimedia.org/wiki/File:${SAVED_FILE}`,
      thumbUrl: expect.stringMatching(
        /^https:\/\/thumb\.wikimedia\.org\/wikipedia\/commons\/thumb\/b\/bc\/.+px-Sen\._Thom_Tillis_/,
      ) as unknown,
    });
  });
});

describe('wikipediaPageImages', () => {
  it('follows redirects to the page image and the Wikidata item', async () => {
    const bucket = createMemoryBucket();
    const body = await zzText('zz-wikipedia-pageimages.json');
    const fetcher = scriptFetcher(bucket, () => ({ body, contentType: 'application/json' }));
    const pages = await wikipediaPageImages(s09Context(bucket, fetcher), ['Fixture Senator']);
    expect(pages.get('Fixture Senator')).toEqual({ pageImage: FILE, wikidataQid: 'Q99999001' });
    const url = new URL(fetcher.requests[0]?.req.url ?? '');
    expect(url.searchParams.get('titles')).toBe('Fixture Senator');
    expect(url.searchParams.get('prop')).toBe('pageprops|pageimages');
    expect(fetcher.requests[0]?.req.class).toBe('api');
  });

  it('reads the saved response for a senator page', async () => {
    const bucket = createMemoryBucket();
    const body = (await saved('wikipedia-pageimages.json')).bytes;
    const fetcher = scriptFetcher(bucket, () => ({ body, contentType: 'application/json' }));
    const pages = await wikipediaPageImages(s09Context(bucket, fetcher), ['Thom Tillis']);
    expect(pages.get('Thom Tillis')).toEqual({ pageImage: SAVED_FILE, wikidataQid: 'Q7786750' });
    const url = new URL(fetcher.requests[0]?.req.url ?? '');
    expect(url.searchParams.get('titles')).toBe('Thom Tillis');
  });

  it('titles are batched by 50', async () => {
    const bucket = createMemoryBucket();
    const fetcher = scriptFetcher(bucket, () => ({
      body: JSON.stringify({ batchcomplete: true, query: { pages: [] } }),
      contentType: 'application/json',
    }));
    const titles = Array.from({ length: 120 }, (_, i) => `Fixture Person ${String(i)}`);
    const pages = await wikipediaPageImages(s09Context(bucket, fetcher), titles);
    expect(fetcher.requests).toHaveLength(3);
    const sizes = fetcher.requests.map(
      (r) => new URL(r.req.url).searchParams.get('titles')?.split('|').length,
    );
    expect(sizes).toEqual([50, 50, 20]);
    expect(pages.size).toBe(120);
    expect(pages.get('Fixture Person 7')).toEqual({ pageImage: null, wikidataQid: null });
  });

  it('a refused batch leaves its titles out of the map', async () => {
    const bucket = createMemoryBucket();
    const fetcher = scriptFetcher(bucket, () => ({ kind: 'disallowed', reason: 'robots' }));
    const pages = await wikipediaPageImages(s09Context(bucket, fetcher), ['Fixture Senator']);
    expect(pages.size).toBe(0);
  });
});

describe('wikipediaTitle', () => {
  it('reads the title of an English Wikipedia article URL only', () => {
    expect(wikipediaTitle('https://en.wikipedia.org/wiki/Fixture_Jos%C3%A9_Senator')).toBe(
      'Fixture José Senator',
    );
    expect(wikipediaTitle('https://ballotpedia.org/Fixture_Senator')).toBeNull();
    expect(wikipediaTitle('https://de.wikipedia.org/wiki/Fixture')).toBeNull();
    expect(wikipediaTitle('https://en.wikipedia.org/w/index.php?title=Fixture')).toBeNull();
  });
});
