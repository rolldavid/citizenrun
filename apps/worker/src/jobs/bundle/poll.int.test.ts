import {
  captureLogs,
  fixtureVersion,
  getTestDb,
  getTestObject,
  insertDataBundle,
  putTestObject,
  resetStorage,
  writeFixtureBundle,
  zzBundle,
} from '@citizenrun/db/testing';
import { LOADER_SCHEMA_REVISION, LoaderInfoSchema } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { peekQueue, runJob } from '../../testing/job.ts';
import { FULL_POINTER_KEY, LOADER_INFO_KEY, bundlePoll } from './poll.ts';

// TEST-bundle-poll.

const TODAY = '2027-01-15';
const NOW = new Date('2027-01-15T06:00:00Z');
const HOUR_MS = 3_600_000;
const OLDER = fixtureVersion('2027-01-14T06:00:00Z', 'full');
const NEWER = fixtureVersion('2027-01-15T05:00:00Z', 'full');

type BundleRow = { id: string; version: string; kind: string; status: string };

async function bundles(): Promise<BundleRow[]> {
  return getTestDb().execute<BundleRow>(
    sql`select id, version, kind, status from data_bundles order by version`,
    'objects',
  );
}

async function publish(version: string): Promise<void> {
  await writeFixtureBundle({
    version,
    files: zzBundle({ today: TODAY, offices: 1, electionsPerOffice: 1 }),
    pointer: true,
  });
}

async function poll(clock = new FakeClock(NOW)): Promise<void> {
  const result = await runJob(bundlePoll, {}, { clock });
  expect(result.outcome).toBe('completed');
}

async function loaderInfo(): Promise<ReturnType<typeof LoaderInfoSchema.parse>> {
  const bytes = await getTestObject('data', LOADER_INFO_KEY);
  if (bytes === null) {
    throw new Error('loader.json was not written.');
  }
  return LoaderInfoSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

function warnings(): Record<string, unknown>[] {
  return captureLogs()
    .lines.filter((line) => line.parsed.level === 'warn')
    .map((line) => line.parsed);
}

function doneLines(): Record<string, unknown>[] {
  return captureLogs()
    .lines.filter((line) => line.parsed.event === 'bundle.poll.done')
    .map((line) => line.parsed);
}

async function staleAlerts(): Promise<unknown[]> {
  return (await peekQueue('ops.alert'))
    .map((job) => job.data)
    .filter(
      (data) =>
        typeof data === 'object' && data !== null && 'kind' in data && data.kind === 'bundle_stale',
    );
}

beforeEach(async () => {
  await resetStorage();
});

describe('J-bundle.poll', () => {
  it('a newer pointer inserts one loading row and one job', async () => {
    await publish(NEWER);
    await poll();
    const rows = await bundles();
    expect(rows.map(({ version, kind, status }) => ({ version, kind, status }))).toEqual([
      { version: NEWER, kind: 'full', status: 'loading' },
    ]);
    const jobs = await peekQueue('bundle.load');
    expect(jobs.map((job) => ({ data: job.data, singletonKey: job.singletonKey }))).toEqual([
      { data: { bundleId: rows[0]?.id, mode: 'new' }, singletonKey: `bundle:${NEWER}` },
    ]);
    expect(doneLines().map((line) => [line.pointer, line.version])).toEqual([['new', NEWER]]);
  });

  it('the same pointer on the next run inserts nothing', async () => {
    await publish(NEWER);
    await poll();
    await poll();
    expect(await bundles()).toHaveLength(1);
    expect(await peekQueue('bundle.load')).toHaveLength(1);
    expect(doneLines().map((line) => line.pointer)).toEqual(['new', 'current']);
  });

  it('an older or equal pointer does nothing', async () => {
    const loaded = await insertDataBundle(getTestDb(), {
      version: NEWER,
      status: 'loaded',
      loadedAt: NOW,
    });
    await publish(OLDER);
    await poll();
    await publish(NEWER);
    await poll();
    expect((await bundles()).map((row) => row.id)).toEqual([loaded.id]);
    expect(await peekQueue('bundle.load')).toEqual([]);
    expect(doneLines().map((line) => line.pointer)).toEqual(['current', 'current']);
  });

  it('a missing pointer does nothing', async () => {
    await poll();
    expect(await bundles()).toEqual([]);
    expect(await peekQueue('bundle.load')).toEqual([]);
    expect(warnings()).toEqual([]);
    expect(doneLines().map((line) => line.pointer)).toEqual(['none']);
  });

  it('an invalid pointer is treated as absent', async () => {
    const sample = JSON.stringify({
      kind: 'full',
      version: 'sample-20270101T000000Z-full',
      manifest: 'bundles/sample-20270101T000000Z-full/manifest.json',
      published_at: '2027-01-01T00:00:00.000Z',
    });
    await putTestObject(
      'data',
      FULL_POINTER_KEY,
      new TextEncoder().encode(sample),
      'application/json',
    );
    await poll();
    expect(warnings().map((line) => [line.event, line.objectKey])).toEqual([
      ['index_file.invalid', FULL_POINTER_KEY],
    ]);

    const garbled = 'fixture-not-json {';
    await putTestObject(
      'data',
      FULL_POINTER_KEY,
      new TextEncoder().encode(garbled),
      'application/json',
    );
    await poll();
    expect(warnings().map((line) => [line.event, line.objectKey])).toEqual([
      ['index_file.invalid', FULL_POINTER_KEY],
      ['index_file.invalid', FULL_POINTER_KEY],
    ]);
    expect(await bundles()).toEqual([]);
    expect(await peekQueue('bundle.load')).toEqual([]);
    // The warning names the key only, never the file's content.
    const raw = captureLogs()
      .lines.map((line) => line.raw)
      .join('\n');
    expect(raw).not.toContain('sample-20270101T000000Z-full');
    expect(raw).not.toContain(garbled);
    expect(doneLines().map((line) => line.pointer)).toEqual(['invalid', 'invalid']);
  });

  it('a pointer of another kind is logged and treated as absent', async () => {
    const geometry = fixtureVersion('2027-01-15T05:00:00Z', 'geometry');
    const pointer = JSON.stringify({
      kind: 'geometry',
      version: geometry,
      manifest: `bundles/${geometry}/manifest.json`,
      published_at: '2027-01-15T05:00:00.000Z',
    });
    await putTestObject(
      'data',
      FULL_POINTER_KEY,
      new TextEncoder().encode(pointer),
      'application/json',
    );
    await poll();
    expect(warnings().map((line) => line.event)).toEqual(['bundle.pointer_invalid']);
    expect(await bundles()).toEqual([]);
  });

  it('a sample row is left out', async () => {
    await insertDataBundle(getTestDb(), {
      version: 'sample-20270101T000000Z-full',
      status: 'loaded',
      loadedAt: NOW,
    });
    const real = fixtureVersion('2027-01-02T00:00:00Z', 'full');
    await publish(real);
    await poll();
    expect((await bundles()).map(({ version, status }) => ({ version, status }))).toEqual([
      { version: real, status: 'loading' },
      { version: 'sample-20270101T000000Z-full', status: 'loaded' },
    ]);
    expect(await peekQueue('bundle.load')).toHaveLength(1);
  });

  it('loader.json is written on every run', async () => {
    const clock = new FakeClock(NOW);
    await poll(clock);
    const first = await loaderInfo();
    expect(first.schema_revision).toBe(LOADER_SCHEMA_REVISION);
    expect(first.updated_at).toBe(NOW.toISOString());

    await publish(NEWER);
    clock.advance(15 * 60_000);
    await poll(clock);
    const second = await loaderInfo();
    expect(second.schema_revision).toBe(LOADER_SCHEMA_REVISION);
    expect(second.updated_at).toBe(clock.now().toISOString());
  });

  it('the alarm fires at 49 hours', async () => {
    const db = getTestDb();
    const row = await insertDataBundle(db, {
      version: OLDER,
      status: 'loaded',
      loadedAt: new Date(NOW.getTime() - 47 * HOUR_MS),
    });
    await poll();
    expect(await staleAlerts()).toEqual([]);

    await db.execute(
      sql`update data_bundles set loaded_at = ${new Date(NOW.getTime() - 49 * HOUR_MS).toISOString()}::timestamptz
          where id = ${row.id}::uuid`,
    );
    await poll();
    expect(await staleAlerts()).toEqual([{ kind: 'bundle_stale', values: { hoursSince: 49 } }]);
    // A second run inside the day is throttled.
    await poll();
    expect(await staleAlerts()).toHaveLength(1);
  });

  it('no alarm on an environment that never loaded a bundle', async () => {
    await poll();
    expect(await staleAlerts()).toEqual([]);
    await insertDataBundle(getTestDb(), {
      version: 'sample-20270101T000000Z-full',
      status: 'loaded',
      loadedAt: new Date(NOW.getTime() - 100 * HOUR_MS),
    });
    await poll();
    expect(await staleAlerts()).toEqual([]);
  });

  it('is idempotent', async () => {
    await publish(NEWER);
    const clock = new FakeClock(NOW);
    await poll(clock);
    const first = await loaderInfo();
    clock.advance(60_000);
    await poll(clock);
    const second = await loaderInfo();
    expect(await bundles()).toHaveLength(1);
    expect(await peekQueue('bundle.load')).toHaveLength(1);
    expect({ ...second, updated_at: first.updated_at }).toEqual(first);
    expect(second.updated_at).not.toBe(first.updated_at);
  });
});
