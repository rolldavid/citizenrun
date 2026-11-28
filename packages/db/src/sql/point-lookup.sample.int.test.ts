import { cpus, platform } from 'node:os';
import { performance } from 'node:perf_hooks';
import { createLogger } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../client.ts';
import { createEnqueue } from '../queue/enqueue.ts';
import { loadSampleBundle } from '../seed/steps/020-sample-bundle.ts';
import { createTestBoss, getTestBucket, getTestDb, resetStorage } from '../testing/index.ts';
import { lookupDistrictsAtPoint } from './point-lookup.ts';

// TEST-point-lookup `sample points resolve` and `lookup stays fast`, on the committed sample. The
// harness empties the database before every case, so each case loads the sample itself.

const COUNTIES = ['37063', '37135', '53067', '53045'];
const LOAD_TIMEOUT_MS = 300_000;
const WARM_UP = 5;
const RUNS = 3;
const P95_BUDGET_MS = 100;

type Point = { readonly lng: number; readonly lat: number };
type Target = { readonly districtKey: string; readonly state: string; readonly point: Point };

async function loadSample(db: Db): Promise<void> {
  await loadSampleBundle(db, {
    anchor: new Date('2027-03-05T12:00:00.000Z'),
    media: await getTestBucket('media'),
    enqueue: createEnqueue(await createTestBoss()),
    log: createLogger({ service: 'api', level: 'error', sink: () => undefined }),
  });
}

/** The four county districts' label points, and each municipality's whose label point the four counties' parts cover. */
async function targets(db: Db): Promise<{ counties: Target[]; cities: Target[]; skipped: number }> {
  const counties: Target[] = [];
  for (const geoid of COUNTIES) {
    const [row] = await db.execute<{ lng: number; lat: number }>(
      sql`select st_x(label_point) as lng, st_y(label_point) as lat from districts
          where source_key = ${`tiger:county:${geoid}`}`,
      'objects',
    );
    expect(row, geoid).toBeDefined();
    if (row !== undefined) {
      counties.push({
        districtKey: `tiger:county:${geoid}`,
        state: geoid.slice(0, 2),
        point: { lng: row.lng, lat: row.lat },
      });
    }
  }
  const rows = await db.execute<{ key: string; lng: number; lat: number; covered: boolean }>(
    sql`select d.source_key as key, st_x(d.label_point) as lng, st_y(d.label_point) as lat,
               exists (
                 select 1 from district_parts p
                 join districts c on c.id = p.district_id
                 where c.source_key = any(${`{${COUNTIES.map((g) => `tiger:county:${g}`).join(',')}}`}::text[])
                   and st_covers(p.geom, d.label_point)
               ) as covered
        from jurisdictions j
        join districts d on d.jurisdiction_id = j.id and d.geometry_quality = 'exact'
        where j.kind = 'city' and d.label_point is not null
        order by d.source_key collate "C"`,
    'objects',
  );
  const cities = rows
    .filter((row) => row.covered)
    .map((row) => ({
      districtKey: row.key,
      state: row.key.replace(/^tiger:place:/, '').slice(0, 2),
      point: { lng: row.lng, lat: row.lat },
    }));
  return { counties, cities, skipped: rows.length - cities.length };
}

async function keysAt(db: Db, point: Point): Promise<string[]> {
  const ids = (await lookupDistrictsAtPoint(db, point)).map((row) => row.id);
  if (ids.length === 0) return [];
  const rows = await db.execute<{ key: string }>(
    sql`select source_key as key from districts where id = any(${`{${ids.join(',')}}`}::uuid[])`,
    'objects',
  );
  return rows.map((row) => row.key);
}

function layerCount(keys: readonly string[], layer: string, state: string): number {
  return keys.filter((key) => key.startsWith(`tiger:${layer}:${state}`)).length;
}

beforeEach(async () => {
  await resetStorage();
});

describe('the point lookup on the sample bundle', () => {
  it('sample points resolve', { timeout: LOAD_TIMEOUT_MS }, async ({ annotate }) => {
    const db = getTestDb();
    await loadSample(db);
    const { counties, cities, skipped } = await targets(db);
    expect(counties).toHaveLength(4);
    expect(cities.length).toBeGreaterThan(0);
    for (const target of [...counties, ...cities]) {
      const keys = await keysAt(db, target.point);
      expect(keys, target.districtKey).toContain(target.districtKey);
      expect(keys, target.districtKey).toContain(`tiger:state:${target.state}`);
      for (const layer of ['cd', 'sldu', 'sldl']) {
        expect(layerCount(keys, layer, target.state), `${target.districtKey} ${layer}`).toBe(1);
      }
    }
    // A municipality whose label point lies outside the four counties has its other county
    // outside the sample, so it is skipped.
    await annotate(
      `sample points: ${String(cities.length)} municipalities checked, ${String(skipped)} skipped`,
    );
  });

  it('lookup stays fast', { timeout: LOAD_TIMEOUT_MS }, async ({ annotate }) => {
    const db = getTestDb();
    await loadSample(db);
    const { counties, cities } = await targets(db);
    const points = [...counties, ...cities].map((target) => target.point);
    expect(points.length).toBeGreaterThan(4);
    for (let i = 0; i < WARM_UP; i += 1) {
      await lookupDistrictsAtPoint(db, points[i % points.length] ?? { lng: 0, lat: 0 });
    }
    const times: number[] = [];
    for (const point of points) {
      for (let run = 0; run < RUNS; run += 1) {
        const started = performance.now();
        await lookupDistrictsAtPoint(db, point);
        times.push(performance.now() - started);
      }
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] ?? Infinity;
    await annotate(
      `lookup p95 ${p95.toFixed(1)} ms over ${String(times.length)} calls on ${platform()} ${cpus()[0]?.model ?? 'unknown cpu'}`,
    );
    expect(p95).toBeLessThan(P95_BUDGET_MS);
  });
});
