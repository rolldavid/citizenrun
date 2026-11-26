import { describe, expect, it } from 'vitest';
import { bucketKeys } from '../lib/bucket.ts';
import { EditionRecordSchema } from './dataset.ts';
import { s01Sample, scriptedRun } from './dataset.fixtures.ts';
import {
  TIGER_LAYERS,
  TIGER_ROOT,
  TigerFormatError,
  ensureLayerFile,
  listLayer,
  matchLayerFile,
  readDbf,
} from './tiger.ts';
import type { TigerLayer } from './tiger.ts';

const layer = (token: string): TigerLayer => {
  const found = TIGER_LAYERS.find((entry) => entry.token === token);
  if (found === undefined) throw new Error(`no layer ${token}`);
  return found;
};

async function pagesRun(extra: Record<string, { contentType: string; body: Uint8Array }> = {}) {
  const pages: Record<string, Uint8Array> = {
    [`${TIGER_ROOT}CD/`]: await s01Sample('tiger/CD-index.html'),
    [`${TIGER_ROOT}STATE/`]: await s01Sample('tiger/STATE-index.html'),
  };
  return scriptedRun((url) => {
    const page = pages[url];
    if (page !== undefined)
      return { kind: 'body', contentType: 'text/html;charset=ISO-8859-1', body: page };
    const file = extra[url];
    return file === undefined ? undefined : { kind: 'body', ...file };
  });
}

describe('tiger', () => {
  it('finds the layer files in a saved directory page', async () => {
    const { ctx, fetcher } = await pagesRun();
    const files = await listLayer(ctx, 'CD');
    expect(files).toContainEqual({ name: 'tl_2026_01_cd120.zip', scope: '01' });
    expect(files).toContainEqual({ name: 'tl_2026_56_cd120.zip', scope: '56' });
    expect(files).toHaveLength(56);
    expect(files.every((file) => /^tl_2026_\d{2}_cd120\.zip$/.test(file.name))).toBe(true);
    expect(await listLayer(ctx, 'STATE')).toEqual([{ name: 'tl_2026_us_state.zip', scope: 'us' }]);
    // A directory is read once per run.
    await listLayer(ctx, 'CD');
    expect(fetcher.requests.map((request) => request.url)).toEqual([
      `${TIGER_ROOT}CD/`,
      `${TIGER_ROOT}STATE/`,
    ]);
    expect(fetcher.requests.every((request) => request.req.class === 'dataset')).toBe(true);
  });

  it('matchLayerFile refuses another year and another layer', () => {
    expect(matchLayerFile('tl_2026_37_cd120.zip', 'cd120')).toEqual({ scope: '37' });
    expect(matchLayerFile('tl_2026_us_zcta520.zip', 'zcta520')).toEqual({ scope: 'us' });
    expect(matchLayerFile('tl_2025_37_cd120.zip', 'cd120')).toBeNull();
    expect(matchLayerFile('tl_2026_37_cd119.zip', 'cd120')).toBeNull();
    expect(matchLayerFile('tl_2026_37_sldu.zip', 'cd120')).toBeNull();
    expect(matchLayerFile('tl_2026_370_cd120.zip', 'cd120')).toBeNull();
    expect(matchLayerFile('tl_2026_37_cd120.zip.xml', 'cd120')).toBeNull();
  });

  it('reads the DC place attributes', async () => {
    const { ctx, bucket } = scriptedRun(() => undefined);
    const key = bucketKeys.dataset('tiger', '2026', 'tl_2026_11_place.zip');
    await bucket.putBytes(key, await s01Sample('tiger/tl_2026_11_place.zip'), 'application/zip');
    expect(await readDbf(key, ctx, ['GEOID', 'NAMELSAD'])).toEqual([
      { GEOID: '1150000', NAMELSAD: 'Washington city' },
    ]);
    const all = await readDbf(key, ctx);
    expect(all[0]).toMatchObject({
      STATEFP: '11',
      PLACEFP: '50000',
      GEOID: '1150000',
      NAME: 'Washington',
    });
  });

  it('a truncated zip fails with a format error', async () => {
    const { ctx, bucket } = scriptedRun(() => undefined);
    const key = bucketKeys.dataset('tiger', '2026', 'tl_2026_11_place.zip');
    await bucket.putBytes(key, await s01Sample('malformed/truncated.zip'), 'application/zip');
    await expect(readDbf(key, ctx)).rejects.toBeInstanceOf(TigerFormatError);
  });

  it('a scope the directory does not list has no file, and a listed one is downloaded', async () => {
    const place = await s01Sample('tiger/tl_2026_11_place.zip');
    const { ctx, bucket } = await pagesRun({
      [`${TIGER_ROOT}STATE/tl_2026_us_state.zip`]: { contentType: 'application/zip', body: place },
    });
    expect(await ensureLayerFile(ctx, layer('state'), '11')).toBeNull();
    const key = await ensureLayerFile(ctx, layer('state'), 'us');
    expect(key).toBe('datasets/tiger/2026/tl_2026_us_state.zip');
    expect(await bucket.head('datasets/tiger/2026/_edition.json')).not.toBeNull();
  });

  it('a cd120 file recorded before the corrected release is downloaded again without a conditional request', async () => {
    const body = await s01Sample('tiger/tl_2026_11_place.zip');
    const url = `${TIGER_ROOT}CD/tl_2026_11_cd120.zip`;
    for (const [downloadedOn, conditional] of [
      ['2026-11-09', false],
      ['2026-11-10', true],
    ] as const) {
      const { ctx, bucket, fetcher } = await pagesRun({
        [url]: { contentType: 'application/zip', body },
      });
      await bucket.putBytes('datasets/tiger/2026/tl_2026_11_cd120.zip', body, 'application/zip');
      await bucket.putJson(
        'datasets/tiger/2026/_edition.json',
        {
          dataset: 'tiger',
          edition: '2026',
          downloaded_on: downloadedOn,
          source_url: TIGER_ROOT,
          seeded: false,
          files: [
            {
              name: 'tl_2026_11_cd120.zip',
              url,
              sha256: 'a'.repeat(64),
              bytes: body.byteLength,
              etag: null,
              last_modified: 'Mon, 09 Nov 2026 12:00:00 GMT',
            },
          ],
        },
        EditionRecordSchema,
      );
      await ensureLayerFile(ctx, layer('cd120'), '11');
      const download = fetcher.requests.find((request) => request.mode === 'download');
      expect(download?.req.conditional !== undefined).toBe(conditional);
    }
  });

  it('the large layers may download up to 2 GB', async () => {
    const body = await s01Sample('tiger/tl_2026_11_place.zip');
    const listing = Buffer.from(
      '<a href="tl_2026_11_tabblock20.zip">tl_2026_11_tabblock20.zip</a>',
    );
    const { ctx, fetcher } = scriptedRun((url) =>
      url.endsWith('/')
        ? { kind: 'body', contentType: 'text/html', body: listing }
        : { kind: 'body', contentType: 'application/zip', body },
    );
    await ensureLayerFile(ctx, layer('tabblock20'), '11');
    expect(fetcher.requests.find((request) => request.mode === 'download')?.req.maxBytes).toBe(
      2_000_000_000,
    );
  });
});
