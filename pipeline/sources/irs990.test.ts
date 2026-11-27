import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { openZipEntry, toTempFile } from '../lib/zip.ts';
import { loadRelevanceDefaults } from '../stages/shared/reference.ts';
import { repoRoot } from '../stages/shared/repo.ts';
import { buildCoops } from '../stages/s02-coops.ts';
import type { CoopsInput } from '../stages/s02-coops.ts';
import { scriptedRun } from './dataset.fixtures.ts';
import { coopsSample, coopsText } from './eia861.fixtures.ts';
import { deflate64Zip } from './irs990.fixtures.ts';
import {
  IrsIndexHeaderError,
  RETURN_MAX_BYTES,
  UNZIP_TIMEOUT_MS,
  batchUrl,
  fetchReturns,
  indexUrl,
  latestReturns,
  loadIndex,
  parseCoopReturn,
  returnKey,
  returnSourceUrl,
  unzipMember,
} from './irs990.ts';
import type { FileRunner, IndexRow } from './irs990.ts';

const SAVED = '202640159349301609_public.xml';

// The nine directors of the saved return, in file order, copied from its Part VII rows:
// ReportableCompFromOrgAmt, OtherCompensationAmt and AverageHoursPerWeekRt.
const DIRECTOR_COMP = [17030, 30884, 17213, 10810, 14841, 10810, 30884, 32534, 32534];
const DIRECTOR_OTHER = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const DIRECTOR_HOURS = [11, 11, 10, 10, 10, 12, 10, 10, 10];

describe('parseCoopReturn', () => {
  it('the saved return gives board size 9 and the median pay and hours', async () => {
    const board = parseCoopReturn(await coopsText(SAVED));
    if (board === 'not_990') throw new Error('the saved return is a Form 990');
    expect(board.is501c12).toBe(true);
    expect(board.boardSize).toBe(9);
    expect(board.boardSizeQuote).toBe(
      '<VotingMembersGoverningBodyCnt>9</VotingMembersGoverningBodyCnt>',
    );
    expect(board.membersElect).toBe(true);
    expect(board.website).toBe('www.naecoop.com');
    expect(board.directors.map((d) => d.comp)).toEqual(DIRECTOR_COMP);
    expect(board.directors.map((d) => d.other)).toEqual(DIRECTOR_OTHER);
    expect(board.directors.map((d) => d.hours)).toEqual(DIRECTOR_HOURS);
    // Values as written: the hours keep their two decimals in the quote.
    expect(board.directors[0]?.quotes.hours).toBe(
      '<AverageHoursPerWeekRt>11.00</AverageHoursPerWeekRt>',
    );

    // Sorted pay: 10810 10810 14841 17030 [17213] 30884 30884 32534 32534; the fifth of nine.
    const pay = DIRECTOR_COMP.map((comp, i) => (comp + (DIRECTOR_OTHER[i] ?? 0)) * 100).sort(
      (a, b) => a - b,
    );
    expect(pay[4]).toBe(1_721_300);
    // Sorted hours: 10 10 10 10 [10] 10 11 11 12.
    const hours = [...DIRECTOR_HOURS].sort((a, b) => a - b);
    expect(hours[4]).toBe(10);

    const ret = {
      ein: '630153273',
      objectId: '202640159349301609',
      batch: '2026_TEOS_XML_01A',
      year: 2026 as const,
      retrievedAt: '2026-11-26T22:18:03.304Z',
      board,
    };
    const input: CoopsInput = {
      state: 'ZZ',
      today: '2026-11-26',
      now: new Date('2026-11-26T23:00:00.000Z'),
      coops: [
        {
          utilityNumber: '99999',
          name: 'Fixture Electric Cooperative',
          counties: [],
          customers: null,
          match: { kind: 'return', ret },
        },
      ],
      counties: new Map(),
      publicPower: [],
      relevanceDefaults: await loadRelevanceDefaults(repoRoot()),
      assignSlugs: (requests) => new Map(requests.map((r) => [r.identity, r.base])),
      fallbackRow: () => Promise.reject(new Error('no via rows')),
      zoneForCoop: () => null,
    };
    const out = await buildCoops(input);
    expect(out.offices).toHaveLength(1);
    const office = out.offices[0];
    expect(office?.body_size).toBe(9);
    expect(office?.seats).toBe(9);
    expect(office?.pay_annual_cents).toBe(pay[4]);
    expect(office?.pay_amount_cents).toBe(pay[4]);
    expect(office?.pay_kind).toBe('stipend');
    expect(office?.pay_period).toBe('year');
    expect(office?.hours_per_week).toBe(hours[4]);
    const source = returnSourceUrl(ret);
    expect(source).toBe(
      'https://apps.irs.gov/pub/epostcard/990/xml/2026/2026_TEOS_XML_01A.zip#202640159349301609_public.xml',
    );
    expect(office?.field_meta['body_size']).toEqual({
      source_url: source,
      quote: '<VotingMembersGoverningBodyCnt>9</VotingMembersGoverningBodyCnt>',
      confidence: 'medium',
      checked_at: '2026-11-26T22:18:03.304Z',
    });
    expect(office?.field_meta['pay_annual_cents']?.quote).toBe(
      '<ReportableCompFromOrgAmt>17213</ReportableCompFromOrgAmt> <OtherCompensationAmt>0</OtherCompensationAmt>',
    );
    expect(office?.field_meta['hours_per_week']?.quote).toBe(
      '<AverageHoursPerWeekRt>10.00</AverageHoursPerWeekRt>',
    );
    expect(out.people).toHaveLength(9);
    expect(out.officeholders).toHaveLength(9);
  });

  it('an absent amount counts as zero', () => {
    const xml = `<?xml version="1.0"?>
<Return xmlns="http://www.irs.gov/efile"><ReturnData><IRS990>
<Organization501cInd organization501cTypeTxt="12">X</Organization501cInd>
<VotingMembersGoverningBodyCnt>5</VotingMembersGoverningBodyCnt>
<Form990PartVIISectionAGrp><PersonNm>Fixture Director</PersonNm><AverageHoursPerWeekRt>2.50</AverageHoursPerWeekRt><IndividualTrusteeOrDirectorInd>X</IndividualTrusteeOrDirectorInd><ReportableCompFromOrgAmt>1200</ReportableCompFromOrgAmt></Form990PartVIISectionAGrp>
<Form990PartVIISectionAGrp><PersonNm>Fixture Officer</PersonNm><OfficerInd>X</OfficerInd><ReportableCompFromOrgAmt>90000</ReportableCompFromOrgAmt></Form990PartVIISectionAGrp>
</IRS990></ReturnData></Return>`;
    const board = parseCoopReturn(xml);
    if (board === 'not_990') throw new Error('a Form 990 fragment');
    expect(board.membersElect).toBeNull();
    expect(board.directors).toEqual([
      {
        name: 'Fixture Director',
        comp: 1200,
        other: 0,
        hours: 2.5,
        quotes: {
          comp: '<ReportableCompFromOrgAmt>1200</ReportableCompFromOrgAmt>',
          other: null,
          hours: '<AverageHoursPerWeekRt>2.50</AverageHoursPerWeekRt>',
        },
      },
    ]);
  });

  it('a namespace prefix and a board that does not elect are read', () => {
    const xml = `<efile:Return xmlns:efile="http://www.irs.gov/efile"><efile:ReturnData><efile:IRS990>
<efile:Organization501cInd organization501cTypeTxt="3">X</efile:Organization501cInd>
<efile:ElectionOfBoardMembersInd>0</efile:ElectionOfBoardMembersInd>
</efile:IRS990></efile:ReturnData></efile:Return>`;
    const board = parseCoopReturn(xml);
    if (board === 'not_990') throw new Error('a Form 990 fragment');
    expect(board.is501c12).toBe(false);
    expect(board.membersElect).toBe(false);
    expect(board.boardSize).toBeNull();
    expect(board.directors).toEqual([]);
  });

  it('a return without IRS990 is not_990', () => {
    expect(
      parseCoopReturn(
        '<Return xmlns="http://www.irs.gov/efile"><ReturnData><IRS990EZ></IRS990EZ></ReturnData></Return>',
      ),
    ).toBe('not_990');
  });
});

function indexRow(taxPeriod: string, objectId: string): IndexRow {
  return {
    returnId: '1',
    filingType: 'EFILE',
    ein: '990000001',
    taxPeriod,
    subDate: '2026',
    taxpayerName: 'Fixture Electric Cooperative',
    returnType: '990',
    dln: '1',
    objectId,
    batch: '2026_TEOS_XML_01A',
  };
}

describe('the index', () => {
  it('the latest tax period wins', () => {
    const older = indexRow('202312', '202600000000000002');
    const newer = indexRow('202412', '202600000000000001');
    expect(latestReturns([newer, older]).get('990000001')).toBe(newer);
    expect(latestReturns([older, newer]).get('990000001')).toBe(newer);
    // A tie goes to the larger OBJECT_ID.
    const tie = indexRow('202412', '202600000000000003');
    expect(latestReturns([newer, tie]).get('990000001')).toBe(tie);
  });

  it('the saved index excerpt gives the saved return', async () => {
    const excerpt = await coopsSample('index-2026-excerpt.csv');
    const { ctx } = scriptedRun((url) =>
      url === indexUrl(2026) ? { kind: 'body', contentType: 'text/csv', body: excerpt } : undefined,
    );
    const index = await loadIndex(ctx, 2026);
    const rows = await index.rows(new Set(['630153273']));
    expect(rows.map((row) => [row.ein, row.taxPeriod, row.objectId, row.batch])).toEqual([
      ['630153273', '202506', '202640159349301609', '2026_TEOS_XML_01A'],
    ]);
    expect(await index.rows(new Set(['990000001']))).toEqual([]);
  });

  it('an index header without XML_BATCH_ID fails', async () => {
    const { ctx } = scriptedRun((url) =>
      url === indexUrl(2026)
        ? {
            kind: 'body',
            contentType: 'text/csv',
            body: 'RETURN_ID,FILING_TYPE,EIN,TAX_PERIOD,SUB_DATE,TAXPAYER_NAME,RETURN_TYPE,DLN,OBJECT_ID\n',
          }
        : undefined,
    );
    const index = await loadIndex(ctx, 2026);
    await expect(index.rows(new Set(['990000001']))).rejects.toBeInstanceOf(IrsIndexHeaderError);
  });
});

const SAVED_ID = '202640159349301609';
const BATCH = '2026_TEOS_XML_01A';

/** The saved return packed with Deflate64 in a batch folder, as the IRS batches hold it. */
async function deflate64Batch(): Promise<Buffer> {
  return deflate64Zip(`${BATCH}/${SAVED}`, await coopsSample(SAVED));
}

function batchRun(zip: Buffer): ReturnType<typeof scriptedRun> {
  return scriptedRun((url) =>
    url === batchUrl(2026, BATCH)
      ? { kind: 'body', contentType: 'application/zip', body: zip }
      : undefined,
  );
}

/** A runner that records its calls and answers with `answer`. */
function recordingRunner(answer: () => Promise<Buffer>): {
  run: FileRunner;
  calls: { file: string; args: readonly string[]; maxBuffer: number; timeout: number }[];
} {
  const calls: { file: string; args: readonly string[]; maxBuffer: number; timeout: number }[] = [];
  return {
    calls,
    run: (file, args, options) => {
      calls.push({ file, args, maxBuffer: options.maxBuffer, timeout: options.timeout });
      return answer();
    },
  };
}

function exitError(code: number): Error {
  return Object.assign(new Error(`Command failed: unzip (exit ${String(code)})`), { code });
}

describe('Deflate64 batches', () => {
  it('yauzl refuses the fixture entry as method 9', async () => {
    const temp = await toTempFile(Readable.from([await deflate64Batch()]), '.zip');
    try {
      await expect(openZipEntry(temp.path, `${BATCH}/${SAVED}`)).rejects.toThrow(
        'unsupported compression method: 9',
      );
    } finally {
      await temp.remove();
    }
  });

  it('the system unzip reads a Deflate64 member', async () => {
    const temp = await toTempFile(Readable.from([await deflate64Batch()]), '.zip');
    try {
      const bytes = await unzipMember(temp.path, `${BATCH}/${SAVED}`);
      expect(bytes?.toString('utf8')).toBe(await coopsText(SAVED));
    } finally {
      await temp.remove();
    }
  });

  it('a Deflate64 return is extracted with unzip, kept, and its batch is not unavailable', async () => {
    const { ctx, bucket } = batchRun(await deflate64Batch());
    const fetched = await fetchReturns(ctx, 2026, [indexRow('202506', SAVED_ID)]);
    expect(fetched.batchUnavailable).toEqual([]);
    const saved = await coopsText(SAVED);
    expect(fetched.returns.get(SAVED_ID)?.xml).toBe(saved);
    const kept = await bucket.getStream(returnKey(2026, SAVED_ID));
    expect(kept).not.toBeNull();
    const board = parseCoopReturn(fetched.returns.get(SAVED_ID)?.xml ?? '');
    expect(board === 'not_990' ? null : board.boardSize).toBe(9);
  });

  it('unzip runs with the batch path and the member as arguments, capped and timed', async () => {
    const { run, calls } = recordingRunner(() => Promise.resolve(Buffer.from('<Return/>')));
    const out = await unzipMember('/tmp/batch.zip', `${BATCH}/${SAVED}`, run);
    expect(out?.toString('utf8')).toBe('<Return/>');
    expect(calls).toEqual([
      {
        file: 'unzip',
        args: ['-p', '/tmp/batch.zip', `${BATCH}/${SAVED}`],
        maxBuffer: RETURN_MAX_BYTES,
        timeout: UNZIP_TIMEOUT_MS,
      },
    ]);
  });

  it('a non-zero exit, an overrun, a timeout or a missing unzip gives no bytes', async () => {
    const failures: (() => Promise<Buffer>)[] = [
      () => Promise.reject(exitError(2)),
      () => Promise.reject(exitError(11)),
      () =>
        Promise.reject(
          Object.assign(new RangeError('stdout maxBuffer length exceeded'), {
            code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          }),
        ),
      () =>
        Promise.reject(
          Object.assign(new Error('Command failed: unzip'), { killed: true, signal: 'SIGKILL' }),
        ),
      () => Promise.reject(Object.assign(new Error('spawn unzip ENOENT'), { code: 'ENOENT' })),
      () => Promise.resolve(Buffer.alloc(RETURN_MAX_BYTES + 1)),
    ];
    for (const answer of failures) {
      const { run } = recordingRunner(answer);
      expect(await unzipMember('/tmp/batch.zip', `${BATCH}/${SAVED}`, run)).toBeNull();
    }
  });

  it('a member name unzip would read as a pattern or an option is never passed to it', async () => {
    const { run, calls } = recordingRunner(() => Promise.resolve(Buffer.from('x')));
    for (const name of ['-x', '*_public.xml', 'a?.xml', '[a].xml', 'a b.xml', 'a/../b.xml']) {
      expect(await unzipMember('/tmp/batch.zip', name, run)).toBeNull();
    }
    expect(calls).toEqual([]);
  });

  it('a Deflate64 return unzip cannot extract leaves it missing and counts its batch', async () => {
    const { ctx, bucket } = batchRun(await deflate64Batch());
    const { run, calls } = recordingRunner(() => Promise.reject(exitError(2)));
    const fetched = await fetchReturns(ctx, 2026, [indexRow('202506', SAVED_ID)], { run });
    expect(calls).toHaveLength(1);
    expect(fetched.batchUnavailable).toEqual([BATCH]);
    expect(fetched.returns.size).toBe(0);
    expect(await bucket.getStream(returnKey(2026, SAVED_ID))).toBeNull();
  });
});
