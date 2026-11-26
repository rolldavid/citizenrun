// The block sums through psql and the real block-sums.sql on the pipeline's scratch PostGIS server
// (PIPELINE_SCRATCH_URL when set, else the default address), in a scratch database this file names
// from testRunId() and checks only by that name (other files and runs create theirs on the same
// server at the same time).
import { spawnSync } from 'node:child_process';
import { createLogger } from '@citizenrun/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PipelineEnv } from '../../env.ts';
import { encodeNdjsonGz } from '../../lib/ndjson.ts';
import { NO_FETCHER, createRunContext } from '../../lib/runner.ts';
import { multiPolygonToWkb, toHex } from '../../lib/wkb.ts';
import type { Position } from '../../lib/wkb.ts';
import { getTestBucket, resetStorage, testRunId, testScratchUrl } from '../../testing/setup.ts';
import { ScratchNameError, assertScratchName, runBlockSums, scratchServer } from './block-sums.ts';

const ENV: PipelineEnv = Object.freeze({
  DATA_BUCKET: 'fixture',
  DATA_ENDPOINT: 'http://localhost:8333',
  DATA_REGION: 'us-east-1',
  DATA_ACCESS_KEY_ID: 'fixture',
  DATA_SECRET_ACCESS_KEY: 'fixture',
  S3_FORCE_PATH_STYLE: true,
  LOG_LEVEL: 'error',
  PIPELINE_RUN_ID: null,
  FEC_API_KEY: null,
  PIPELINE_SCRATCH_URL: testScratchUrl(),
  isCi: false,
});

function databaseCount(name: string): string {
  const result = spawnSync('psql', ['-X', '-At', '-d', scratchServer(ENV), '-v', `name=${name}`], {
    encoding: 'utf8',
    input: "select count(*) from pg_database where datname = :'name';\n",
  });
  if (result.status !== 0) throw new Error(`psql failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** A closed ring along the edges of the box, with `perSide` points on each side. */
function boxRing(x0: number, y0: number, x1: number, y1: number, perSide = 1): Position[] {
  const ring: Position[] = [];
  const side = (ax: number, ay: number, bx: number, by: number) => {
    for (let i = 0; i < perSide; i += 1) {
      ring.push([ax + ((bx - ax) * i) / perSide, ay + ((by - ay) * i) / perSide]);
    }
  };
  side(x0, y0, x1, y0);
  side(x1, y0, x1, y1);
  side(x1, y1, x0, y1);
  side(x0, y1, x0, y0);
  ring.push([x0, y0]);
  return ring;
}

const hex = (rings: Position[][]): string => toHex(multiPolygonToWkb([rings]));

beforeEach(async () => {
  await resetStorage();
});

describe('runBlockSums', () => {
  it('sums the blocks each district covers, once per district, and lists invalid districts', async () => {
    const { bucket } = await getTestBucket('data');
    const ctx = createRunContext({
      env: ENV,
      now: new Date('2026-11-26T12:00:00.000Z'),
      bucket,
      fetcher: NO_FETCHER,
      log: createLogger({ service: 'pipeline', level: 'error', sink: () => undefined }),
    });
    // Made-up ZZ blocks: one inside each square, one on their shared edge, one on the centre
    // line where st_subdivide cuts the 600-point square, one outside every district.
    const blocks = [
      { geoid: '990010001001000', p1: 10, p3: 7, lng: 0.5, lat: 0.5 },
      { geoid: '990010001001001', p1: 20, p3: 15, lng: 1.5, lat: 0.5 },
      { geoid: '990010001001002', p1: 4, p3: 3, lng: 1, lat: 0.5 },
      { geoid: '990010001001003', p1: 5, p3: 2, lng: 11, lat: 1 },
      { geoid: '990010001001004', p1: 100, p3: 90, lng: 50, lat: 50 },
    ];
    const blocksKey = 'datasets/pl94171/2020/blocks-ZZ.ndjson.gz';
    await bucket.putBytes(blocksKey, encodeNdjsonGz(blocks), 'application/gzip');
    const bowTie: Position[] = [
      [0, 10],
      [2, 12],
      [2, 10],
      [0, 12],
      [0, 10],
    ];
    const runId = testRunId();
    const result = await runBlockSums(
      {
        runId,
        blocksKey,
        districts: [
          { key: 'zz:a', lookupWkbHex: hex([boxRing(0, 0, 1, 1)]) },
          { key: 'zz:b', lookupWkbHex: hex([boxRing(1, 0, 2, 1)]) },
          { key: 'zz:cut', lookupWkbHex: hex([boxRing(10, 0, 12, 2, 150)]) },
          { key: 'zz:bowtie', lookupWkbHex: hex([bowTie]) },
        ],
      },
      ctx,
    );
    // Hand-worked: a covers blocks 000 and 002 (10 + 4, 7 + 3); b covers 001 and 002 (20 + 4,
    // 15 + 3); the cut square covers 003 once although it sits on the cut between its parts.
    expect([...result.sums]).toEqual([
      ['zz:a', { p1: 14, p3: 10, blocks: 2 }],
      ['zz:b', { p1: 24, p3: 18, blocks: 2 }],
      ['zz:cut', { p1: 5, p3: 2, blocks: 1 }],
    ]);
    expect(result.invalid).toEqual(['zz:bowtie']);
    expect(databaseCount(`pipeline_scratch_${runId}`)).toBe('0');
  });

  it('drops the scratch database when the SQL fails', async () => {
    const { bucket } = await getTestBucket('data');
    const ctx = createRunContext({
      env: ENV,
      now: new Date('2026-11-26T12:00:00.000Z'),
      bucket,
      fetcher: NO_FETCHER,
      log: createLogger({ service: 'pipeline', level: 'error', sink: () => undefined }),
    });
    const blocksKey = 'datasets/pl94171/2020/blocks-ZZ.ndjson.gz';
    await bucket.putBytes(
      blocksKey,
      encodeNdjsonGz([{ geoid: '990010001001000', p1: 1, p3: 1, lng: 0.5, lat: 0.5 }]),
      'application/gzip',
    );
    const runId = testRunId();
    await expect(
      runBlockSums(
        { runId, blocksKey, districts: [{ key: 'zz:broken', lookupWkbHex: 'abcd' }] },
        ctx,
      ),
    ).rejects.toThrow(/psql exited/);
    expect(databaseCount(`pipeline_scratch_${runId}`)).toBe('0');
  });

  it('refuses a name that is not a scratch name before any statement', () => {
    expect(() => {
      assertScratchName('citizenrun');
    }).toThrow(ScratchNameError);
    expect(() => {
      assertScratchName('pipeline_scratch_x"; drop database citizenrun; --');
    }).toThrow(ScratchNameError);
    expect(() => {
      assertScratchName(`pipeline_scratch_${'x'.repeat(50)}`);
    }).toThrow(ScratchNameError);
  });
});
