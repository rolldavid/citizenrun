import { createHash } from 'node:crypto';
import {
  BundleStatsSchema,
  firstFailedGate,
  insertLoadingBundle,
  revertBundle,
} from '@citizenrun/db/bundle';
import type { BundleStats } from '@citizenrun/db/bundle';
import {
  GATE_FAULTS,
  HOLD_FAULTS,
  captureLogs,
  fixtureVersion,
  getTestDb,
  getTestObject,
  insertDataBundle,
  loadFixture,
  putTestObject,
  resetStorage,
  snapshotCivic,
  writeFixtureBundle,
  zzBundle,
  zzGeometry,
  zzPhotoJpeg,
} from '@citizenrun/db/testing';
import type { FixtureBundleInput, FixtureRows, GateFault } from '@citizenrun/db/testing';
import { newId } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { withCivicLock } from '../../lib/civic-lock.ts';
import { peekQueue, runJob } from '../../testing/job.ts';
import type { RunJobResult } from '../../testing/job.ts';
import { bundleLoad } from './load.ts';

// J-bundle.load over the load core: the job's outcomes, alerts, supersession and failure path.

const TODAY = '2027-01-15';
const NOW = new Date('2027-01-15T06:00:00Z');
const LATER = new Date('2027-01-16T06:00:00Z');

type Mode = 'new' | 'approved' | 'reload';

function version(minute: number): string {
  return fixtureVersion(`2027-01-15T06:${String(minute).padStart(2, '0')}:00Z`, 'full');
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function input(
  minute: number,
  files: FixtureRows = zzBundle({ today: TODAY }),
): FixtureBundleInput {
  return { version: version(minute), files: structuredClone(files), geometry: zzGeometry() };
}

/** A valid ZZ bundle with one photo, as the gate faults expect. */
async function photoInput(minute: number): Promise<FixtureBundleInput> {
  const photo = await zzPhotoJpeg();
  return {
    version: version(minute),
    files: zzBundle({ today: TODAY, photoSha: sha256(photo) }),
    geometry: zzGeometry(),
    assets: [{ kind: 'photo', bytes: photo }],
  };
}

/** Writes the bundle and inserts its `loading` row, as J-bundle.poll does. */
async function publishLoading(bundle: FixtureBundleInput): Promise<string> {
  await writeFixtureBundle(bundle);
  const id = await getTestDb().transaction((tx) =>
    insertLoadingBundle(tx, { version: bundle.version, kind: 'full' }),
  );
  if (id === null) {
    throw new Error('A bundle of this version already exists.');
  }
  return id;
}

function load(
  bundleId: string,
  mode: Mode = 'new',
  at: Date = NOW,
  retryCount = 0,
): Promise<RunJobResult> {
  return runJob(bundleLoad, { bundleId, mode }, { clock: new FakeClock(at), retryCount });
}

/** Publishes and loads a bundle through the job; it must end loaded. */
async function loadThroughJob(bundle: FixtureBundleInput, at: Date = NOW): Promise<string> {
  const bundleId = await publishLoading(bundle);
  const result = await load(bundleId, 'new', at);
  expect(result.outcome).toBe('completed');
  expect(await statusOf(bundleId)).toBe('loaded');
  return bundleId;
}

async function row(bundleId: string): Promise<{ status: string; stats: BundleStats | null }> {
  const [found] = await getTestDb().execute<{ status: string; stats: unknown }>(
    sql`select status, stats from data_bundles where id = ${bundleId}::uuid`,
    'objects',
  );
  if (found === undefined) {
    throw new Error('No such bundle.');
  }
  return {
    status: found.status,
    stats: found.stats === null ? null : BundleStatsSchema.parse(found.stats),
  };
}

async function statusOf(bundleId: string): Promise<string> {
  return (await row(bundleId)).status;
}

async function setStatus(bundleId: string, status: string): Promise<void> {
  await getTestDb().execute(
    sql`update data_bundles set status = ${status} where id = ${bundleId}::uuid`,
  );
}

type AlertData = { kind: string; values: Record<string, unknown> };

async function alerts(kind: string): Promise<AlertData[]> {
  const found: AlertData[] = [];
  for (const job of await peekQueue('ops.alert')) {
    const data = job.data as AlertData; // jobs this file's runs sent through the payload schema
    if (data.kind === kind) {
      found.push(data);
    }
  }
  return found;
}

async function allBundleAlerts(): Promise<AlertData[]> {
  return [
    ...(await alerts('bundle_rejected')),
    ...(await alerts('bundle_held')),
    ...(await alerts('bundle_stale')),
  ];
}

async function changesOf(bundleId: string): Promise<number> {
  const [found] = await getTestDb().execute<{ n: number }>(
    sql`select count(*)::int as n from bundle_changes where bundle_id = ${bundleId}::uuid`,
    'objects',
  );
  return found?.n ?? -1;
}

function events(event: string): Record<string, unknown>[] {
  return captureLogs()
    .lines.filter((line) => line.parsed.event === event)
    .map((line) => line.parsed);
}

async function expectGateRejects(fault: GateFault): Promise<void> {
  const db = getTestDb();
  let base: FixtureBundleInput;
  if (fault.needsPriorLoad) {
    // The shrink gate compares with 1,000 live rows.
    const files = zzBundle({ today: TODAY, offices: 1000, electionsPerOffice: 1 });
    await loadFixture(db, input(0, files), { now: NOW });
    base = input(1, files);
  } else {
    base = await photoInput(1);
  }
  const before = await snapshotCivic(db);
  const bundleId = await publishLoading(fault.build(base));
  const result = await load(bundleId, 'new', LATER);
  expect(result.outcome).toBe('completed');
  const stored = await row(bundleId);
  expect(stored.status).toBe('rejected');
  expect(stored.stats === null ? null : firstFailedGate(stored.stats)?.name).toBe(fault.gate);
  const rejected = await alerts('bundle_rejected');
  expect(rejected).toEqual([
    { kind: 'bundle_rejected', values: { bundleId, version: base.version, gate: fault.gate } },
  ]);
  expect(await snapshotCivic(db)).toEqual(before);
  expect(events('bundle.rejected').map((line) => line.gate)).toEqual([fault.gate]);
}

async function holdCase(label: string): Promise<void> {
  const fault = HOLD_FAULTS.find((candidate) => candidate.label === label);
  if (fault === undefined) {
    throw new Error(`No hold fault ${label}.`);
  }
  const db = getTestDb();
  const files = fault.first(TODAY);
  await loadFixture(db, input(0, files), { now: NOW });
  const bundleId = await publishLoading(fault.build(input(1, files), files));
  const result = await load(bundleId, 'new', LATER);
  expect(result.outcome).toBe('completed');
  const stored = await row(bundleId);
  if (fault.hold === null) {
    expect(stored.status).toBe('loaded');
    expect(await alerts('bundle_held')).toEqual([]);
    return;
  }
  expect(stored.status).toBe('held');
  expect(stored.stats?.holds).toEqual([fault.hold]);
  expect(await alerts('bundle_held')).toEqual([
    { kind: 'bundle_held', values: { bundleId, version: version(1) } },
  ]);
  expect(await alerts('bundle_rejected')).toEqual([]);
  expect(events('bundle.held').map((line) => line.holds)).toEqual([[fault.hold]]);
}

beforeEach(async () => {
  await resetStorage();
});

describe('J-bundle.load', () => {
  describe('each gate rejects with one alert', () => {
    for (const fault of GATE_FAULTS) {
      it(`${fault.label} rejects at ${fault.gate}`, async () => {
        await expectGateRejects(fault);
      });
    }
  });

  describe('each hold holds with one alert', () => {
    for (const fault of HOLD_FAULTS) {
      it(`${fault.label} ${fault.hold === null ? 'loads with no alert' : `holds at ${fault.hold}`}`, async () => {
        await holdCase(fault.label);
      });
    }
  });

  it('an approved load skips the holds', async () => {
    const fault = HOLD_FAULTS.find((candidate) => candidate.label === 'offices-over');
    if (fault === undefined) {
      throw new Error('No offices-over fault.');
    }
    const files = fault.first(TODAY);
    await loadFixture(getTestDb(), input(0, files), { now: NOW });
    const bundleId = await publishLoading(fault.build(input(1, files), files));
    await load(bundleId, 'new', LATER);
    expect(await statusOf(bundleId)).toBe('held');
    // E-ADM-04 sets the row to loading in the transaction that sends the approved load.
    await setStatus(bundleId, 'loading');
    const approved = await load(bundleId, 'approved', LATER);
    expect(approved.outcome).toBe('completed');
    expect(await statusOf(bundleId)).toBe('loaded');
    expect(await alerts('bundle_held')).toHaveLength(1);
  });

  it('a reload of a rejected or reverted bundle loads', async () => {
    const db = getTestDb();
    const first = input(0);
    await writeFixtureBundle(first);
    const rejected = await insertDataBundle(db, {
      version: first.version,
      status: 'rejected',
      loadedAt: null,
    });
    // E-ADM-03 sets the row to loading in the transaction that sends the reload.
    await setStatus(rejected.id, 'loading');
    expect((await load(rejected.id, 'reload')).outcome).toBe('completed');
    expect(await statusOf(rejected.id)).toBe('loaded');

    const second = await loadThroughJob(input(1), LATER);
    await revertBundle(db, second, LATER);
    expect(await statusOf(second)).toBe('reverted');
    await setStatus(second, 'loading');
    expect((await load(second, 'reload', LATER)).outcome).toBe('completed');
    expect(await statusOf(second)).toBe('loaded');
    expect(await allBundleAlerts()).toEqual([]);
  });

  it('a reload under a newer loaded bundle is superseded', async () => {
    const db = getTestDb();
    const older = input(0);
    await writeFixtureBundle(older);
    const newer = await loadThroughJob(input(1));
    const before = await snapshotCivic(db);
    const reloaded = await insertDataBundle(db, {
      version: older.version,
      status: 'loading',
      loadedAt: null,
    });
    expect((await load(reloaded.id, 'reload')).outcome).toBe('completed');
    const stored = await row(reloaded.id);
    expect(stored.status).toBe('rejected');
    expect(stored.stats?.gates).toEqual([
      { name: 'superseded', passed: false, detail: version(1) },
    ]);
    expect(await statusOf(newer)).toBe('loaded');
    expect(await snapshotCivic(db)).toEqual(before);
    expect(await allBundleAlerts()).toEqual([]);
  });

  it('a superseded new bundle is rejected', async () => {
    const db = getTestDb();
    await insertDataBundle(db, { version: version(5), status: 'loaded', loadedAt: NOW });
    // A sample- version sorts above every real one and never supersedes (D-458).
    await insertDataBundle(db, {
      version: 'sample-20270101T000000Z-full',
      status: 'loaded',
      loadedAt: NOW,
    });
    const older = await db.transaction((tx) =>
      insertLoadingBundle(tx, { version: version(1), kind: 'full' }),
    );
    if (older === null) {
      throw new Error('No loading row.');
    }
    expect((await load(older)).outcome).toBe('completed');
    const stored = await row(older);
    expect(stored.status).toBe('rejected');
    expect(stored.stats === null ? null : firstFailedGate(stored.stats)).toEqual({
      name: 'superseded',
      passed: false,
      detail: version(5),
    });
    expect(await allBundleAlerts()).toEqual([]);
  });

  it('a row that is not loading is left alone', async () => {
    const db = getTestDb();
    let minute = 0;
    for (const status of ['loaded', 'held', 'rejected'] as const) {
      for (const mode of ['new', 'approved', 'reload'] as const) {
        minute += 1;
        const bundle = await insertDataBundle(db, {
          version: version(minute),
          status,
          loadedAt: status === 'loaded' ? NOW : null,
        });
        const before = await snapshotCivic(db);
        const result = await load(bundle.id, mode);
        expect(result.outcome, `${status} ${mode}`).toBe('completed');
        expect(await row(bundle.id), `${status} ${mode}`).toEqual({ status, stats: null });
        expect(await snapshotCivic(db)).toEqual(before);
      }
    }
    expect(events('bundle.load.skipped')).toHaveLength(9);
    expect(await allBundleAlerts()).toEqual([]);
  });

  it('an unknown bundle is a permanent failure', async () => {
    const result = await load(newId());
    expect(result.outcome).toBe('permanent');
  });

  it('the last failed attempt ends rejected with load_error', async () => {
    const db = getTestDb();
    const bundleId = await publishLoading(input(0));
    await db.execute(
      sql`create function fixture_raise() returns trigger language plpgsql as $$ begin raise exception 'fixture failure'; end $$`,
    );
    await db.execute(
      sql`create trigger fixture_raise before insert on offices for each row execute function fixture_raise()`,
    );
    try {
      for (const retryCount of [0, 1]) {
        const attempt = await load(bundleId, 'new', NOW, retryCount);
        expect(attempt.outcome, `attempt ${String(retryCount + 1)}`).toBe('failed');
        expect(await statusOf(bundleId)).toBe('loading');
        expect(await alerts('bundle_rejected')).toEqual([]);
      }
      const last = await load(bundleId, 'new', NOW, 2);
      expect(last.outcome).toBe('failed');
    } finally {
      await db.execute(sql`drop trigger fixture_raise on offices`);
      await db.execute(sql`drop function fixture_raise()`);
    }
    const stored = await row(bundleId);
    expect(stored.status).toBe('rejected');
    const gate = stored.stats === null ? null : firstFailedGate(stored.stats);
    expect(gate?.name).toBe('load_error');
    // The error's class, never its message.
    expect(gate?.detail).toMatch(/^[A-Za-z][A-Za-z0-9_]*$/);
    expect(JSON.stringify(stored.stats)).not.toContain('fixture failure');
    expect(await alerts('bundle_rejected')).toEqual([
      { kind: 'bundle_rejected', values: { bundleId, version: version(0), gate: 'load_error' } },
    ]);
    const raw = captureLogs()
      .lines.map((line) => line.raw)
      .join('\n');
    expect(raw).not.toContain('fixture failure');
  });

  it('a busy civic lock re-sends the job', async () => {
    const db = getTestDb();
    const bundleId = await publishLoading(input(0));
    const sentAt = Date.now();
    const held = await withCivicLock(db, () => load(bundleId));
    expect(held.ran).toBe(true);
    if (held.ran) {
      expect(held.value.outcome).toBe('completed');
    }
    expect(await statusOf(bundleId)).toBe('loading');
    expect(await changesOf(bundleId)).toBe(0);
    const jobs = await peekQueue('bundle.load');
    expect(jobs.map((job) => ({ data: job.data, singletonKey: job.singletonKey }))).toEqual([
      { data: { bundleId, mode: 'new' }, singletonKey: null },
    ]);
    const delayMs = (jobs[0]?.startAfter.getTime() ?? 0) - sentAt;
    expect(delayMs).toBeGreaterThan(100_000);
    expect(delayMs).toBeLessThan(140_000);
    const busy = events('civic_lock.busy');
    expect(busy).toHaveLength(1);
    expect(busy[0]?.level).toBe('info');
  });

  it('hostile fixtures reject', async () => {
    for (const label of ['javascript-link', 'outline-markup']) {
      const fault = GATE_FAULTS.find((candidate) => candidate.label === label);
      if (fault === undefined) {
        throw new Error(`No fault ${label}.`);
      }
      await resetStorage();
      const base = await photoInput(label === 'javascript-link' ? 1 : 2);
      const bundleId = await publishLoading(fault.build(base));
      await load(bundleId);
      const stored = await row(bundleId);
      expect(stored.status, label).toBe('rejected');
      expect(stored.stats === null ? null : firstFailedGate(stored.stats)?.name, label).toBe(
        'schema_valid',
      );
    }
    expect(await alerts('bundle_rejected')).toHaveLength(2);
    expect(await getTestDb().execute(sql`select 1 from offices`, 'objects')).toEqual([]);
  });

  it('an override survives a load', async () => {
    const db = getTestDb();
    const files = zzBundle({ today: TODAY });
    await loadThroughJob(input(0, files));
    const at = NOW.toISOString();
    await db.execute(
      sql`update offices set title = 'Fixture Corrected Title',
            overrides = jsonb_build_object('title', jsonb_build_object('value', 'Fixture Corrected Title',
              'suppressed', false, 'by', ${newId()}::text, 'role', 'admin', 'at', ${at}::text))
          where slug = 'zz-fixture-seat-001'`,
    );
    await loadThroughJob(input(1, files), LATER);
    const [office] = await db.execute<{ title: string }>(
      sql`select title from offices where slug = 'zz-fixture-seat-001'`,
      'objects',
    );
    expect(office?.title).toBe('Fixture Corrected Title');
  });

  it('a photo asset is written once', async () => {
    const db = getTestDb();
    const first = await photoInput(0);
    const photo = first.assets?.[0]?.bytes;
    if (photo === undefined) {
      throw new Error('No photo.');
    }
    const key = `civic/photos/${sha256(photo)}.jpg`;
    await loadThroughJob(first);
    const stored = await getTestObject('media', key);
    if (stored === null) {
      throw new Error('The photo was not written.');
    }
    const meta = await sharp(stored).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 320, 400]);
    const person = sql`select photo_key, photo_width, photo_height from people where slug = 'fixture-holder-001'`;
    expect(await db.execute(person, 'objects')).toEqual([
      { photo_key: key, photo_width: 320, photo_height: 400 },
    ]);

    // Other bytes under the same key: a second load neither reads nor writes the object.
    const other = new Uint8Array(
      await sharp({
        create: { width: 10, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .jpeg()
        .toBuffer(),
    );
    await putTestObject('media', key, other, 'image/jpeg');
    await loadThroughJob({ ...(await photoInput(1)) }, LATER);
    expect(await getTestObject('media', key)).toEqual(other);
    expect(await db.execute(person, 'objects')).toEqual([
      { photo_key: key, photo_width: 320, photo_height: 400 },
    ]);
  });

  it('the same bundle twice changes nothing', async () => {
    const files = zzBundle({ today: TODAY });
    const first = await loadThroughJob(input(0, files));
    expect(await changesOf(first)).toBeGreaterThan(0);
    const before = await snapshotCivic(getTestDb());
    const second = await loadThroughJob(input(1, files), NOW);
    expect(await changesOf(second)).toBe(0);
    expect(await snapshotCivic(getTestDb())).toEqual(before);
  });

  it('is idempotent', async () => {
    const bundleId = await loadThroughJob(input(0));
    const changes = await changesOf(bundleId);
    const scoring = (await peekQueue('score.issues')).length;
    const again = await load(bundleId);
    expect(again.outcome).toBe('completed');
    expect(events('bundle.load.skipped').map((line) => line.status)).toEqual(['loaded']);
    expect(events('bundle.loaded')).toHaveLength(1);
    expect(await changesOf(bundleId)).toBe(changes);
    expect(await peekQueue('score.issues')).toHaveLength(scoring);
  });

  it('a loaded bundle logs its counts and ids only', async () => {
    const bundleId = await loadThroughJob(input(0));
    const [loaded] = events('bundle.loaded');
    expect(loaded?.bundleId).toBe(bundleId);
    expect(loaded?.counts).toMatchObject({ offices: { inserted: 20, updated: 0, retired: 0 } });
    expect(Object.keys(loaded ?? {}).sort()).toEqual(
      ['bundleId', 'counts', 'event', 'job', 'jobId', 'level', 'service', 'time'].sort(),
    );
  });
});
