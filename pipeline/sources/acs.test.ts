import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CsvFormatError } from '../lib/csv.ts';
import {
  ACS_DIRECTORY,
  AcsFileError,
  AcsFormatError,
  ensureAcsFile,
  listAcsFile,
  pickB01001,
  readB01001,
  readParsedAcs,
  writeParsedAcs,
} from './acs.ts';
import type { AcsRow } from './acs.ts';
import { s01Sample, scriptedRun } from './dataset.fixtures.ts';

const SAMPLE = 'acs/b01001-dc-nc.dat';

async function readAll(text: string): Promise<AcsRow[]> {
  const rows: AcsRow[] = [];
  for await (const row of readB01001(Readable.from([Buffer.from(text)]))) {
    rows.push(row);
  }
  return rows;
}

const sampleText = async () => Buffer.from(await s01Sample(SAMPLE)).toString('utf8');
const sampleLines = async () => (await sampleText()).split('\n').filter((line) => line !== '');

describe('acs', () => {
  it('listAcsFile picks B01001 and not its iterations', async () => {
    const page = await s01Sample('acs/5YRData-index.html');
    const { ctx, fetcher } = scriptedRun((url) =>
      url === ACS_DIRECTORY
        ? { kind: 'body', contentType: 'text/html;charset=ISO-8859-1', body: page }
        : undefined,
    );
    await expect(listAcsFile(ctx)).resolves.toEqual({
      name: 'acsdt5y2024-b01001.dat',
      url: `${ACS_DIRECTORY}acsdt5y2024-b01001.dat`,
    });
    expect(fetcher.requests).toHaveLength(1);
    expect(() => pickB01001(['acsdt5y2024-b01001a.dat', 'acsdt5y2024-b01001i.dat'])).toThrow(
      AcsFileError,
    );
    expect(() => pickB01001(['acsdt5y2024-b01001.dat', 'other_b01001.dat'])).toThrow(AcsFileError);
  });

  it('ensureAcsFile stores the listed file, which the host sends with no content type', async () => {
    const page = await s01Sample('acs/5YRData-index.html');
    const body = await s01Sample(SAMPLE);
    const { ctx, bucket, fetcher } = scriptedRun((url) => {
      if (url === ACS_DIRECTORY)
        return { kind: 'body', contentType: 'text/html;charset=ISO-8859-1', body: page };
      if (url === `${ACS_DIRECTORY}acsdt5y2024-b01001.dat`)
        return { kind: 'body', contentType: '', body };
      return undefined;
    });
    await expect(ensureAcsFile(ctx)).resolves.toBe(
      'datasets/acs5/2020-2024/acsdt5y2024-b01001.dat',
    );
    expect(await bucket.getBytes('datasets/acs5/2020-2024/acsdt5y2024-b01001.dat')).toEqual(body);
    expect(fetcher.requests.find((request) => request.mode === 'download')?.req.maxBytes).toBe(
      500_000_000,
    );
  });

  it('the 18-and-over sum of one saved row is hand-computed', async () => {
    const rows = await readAll(await sampleText());
    const dc = rows.find((row) => row.geo_id === '0500000US11001');
    // 0500000US11001, District of Columbia, from the saved line:
    //   B01001_E001 (total) = 681294
    //   male E007 to E025:   8544 + 3818 + 3548 + 13174 + 32529 + 37196 + 30537 + 25366 + 18601
    //                        + 17697 + 16622 + 6119 + 9224 + 5576 + 6881 + 9681 + 6642 + 4096 + 3436 = 259287
    //   female E031 to E049: 10817 + 4085 + 4348 + 16727 + 40502 + 39972 + 31953 + 25891 + 18902
    //                        + 17173 + 16273 + 6868 + 10335 + 6540 + 8500 + 13324 + 10006 + 6363 + 6114 = 294693
    //   18 and over = 259287 + 294693 = 553980
    expect(dc).toEqual({
      geo_id: '0500000US11001',
      sumlev: '050',
      geoid: '11001',
      total: 681294,
      age18: 553980,
    });
  });

  it('keeps only the summary levels it needs', async () => {
    const lines = await sampleLines();
    const stateLine = lines.find((line) => line.startsWith('0400000US11|')) ?? '';
    const rest = stateLine.slice(stateLine.indexOf('|'));
    const extra = [
      `1500000US110010001011${rest}`, // a block group
      `5000000US1198${rest}`, // a congressional district
      `04000A0US11${rest}`, // a geographic component of the state
      `9700000US1100030${rest}`, // a unified school district
    ];
    const rows = await readAll(`${[...lines, ...extra].join('\n')}\n`);
    expect(rows.map((row) => [row.sumlev, row.geoid])).toEqual([
      ['040', '11'],
      ['040', '37'],
      ['050', '11001'],
      ['050', '37183'],
      ['970', '1100030'],
    ]);
  });

  it('a short line fails with its line number', async () => {
    const lines = await sampleLines();
    lines[2] = (lines[2] ?? '').slice(0, (lines[2] ?? '').lastIndexOf('|'));
    const error = await readAll(`${lines.join('\n')}\n`).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CsvFormatError);
    expect((error as CsvFormatError).line).toBe(3);
  });

  it('a kept row whose estimate is not a count fails with its line number', async () => {
    const lines = await sampleLines();
    const fields = (lines[4] ?? '').split('|');
    fields[13] = '-666666666';
    lines[4] = fields.join('|');
    const error = await readAll(`${lines.join('\n')}\n`).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AcsFormatError);
    expect((error as AcsFormatError).line).toBe(5);
  });

  it('a header without an estimate column fails', async () => {
    const lines = await sampleLines();
    lines[0] = (lines[0] ?? '').replace('B01001_E031', 'B01001_X031');
    await expect(readAll(`${lines.join('\n')}\n`)).rejects.toBeInstanceOf(AcsFormatError);
  });

  it('the parsed rows round-trip through parsed.ndjson.gz', async () => {
    const rows = await readAll(await sampleText());
    const { ctx } = scriptedRun(() => undefined);
    await expect(writeParsedAcs(ctx, rows)).resolves.toMatchObject({
      key: 'datasets/acs5/2020-2024/parsed.ndjson.gz',
      rows: 4,
    });
    const back: AcsRow[] = [];
    for await (const row of readParsedAcs(ctx)) back.push(row);
    expect(back).toEqual(rows);
  });
});
