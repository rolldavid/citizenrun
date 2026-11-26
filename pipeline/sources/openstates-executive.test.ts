import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createMemoryBucket } from '../testing/memory-bucket.ts';
import {
  buildTarGz,
  saved,
  s09Context,
  scriptFetcher,
  zzExecutiveYaml,
} from '../__fixtures__/s09/zz-s09.ts';
import {
  EXECUTIVE_PATH,
  OPENSTATES_PEOPLE_COMMIT_URL,
  OPENSTATES_PEOPLE_TARBALL,
  TarFormatError,
  executiveOfficeType,
  isCurrentRole,
  loadExecutives,
  parseExecutive,
  readTarGz,
} from './openstates-executive.ts';
import { DatasetUnavailableError } from './dataset.ts';

const STEIN = 'executive/Josh-Stein-0a494878-c7fd-4a6a-8b82-3eb681e3fe6e.yml';
const HUNT = 'executive/Rachel-Hunt-4c3a1120-2dd5-4fbe-a084-e64894e57163.yml';
const COMMIT = '6c96e49451833e745fb4f529bb631fa04ae1148a';
const ROOT = `people-${COMMIT}`;

async function collect(
  bytes: Uint8Array,
  keep: (path: string) => boolean,
): Promise<{
  entries: { path: string; bytes: Uint8Array }[];
  global: ReadonlyMap<string, string>[];
}> {
  const entries: { path: string; bytes: Uint8Array }[] = [];
  const global: ReadonlyMap<string, string>[] = [];
  for await (const entry of readTarGz(Readable.from([Buffer.from(bytes)]), keep, {
    onGlobalHeader: (records) => global.push(records),
  })) {
    entries.push(entry);
  }
  return { entries, global };
}

describe('readTarGz', () => {
  it('yields the kept files with their paths and bytes, and reads the global header', async () => {
    const stein = (await saved(STEIN)).bytes;
    const hunt = (await saved(HUNT)).bytes;
    const steinPath = `${ROOT}/data/nc/executive/Josh-Stein-0a494878-c7fd-4a6a-8b82-3eb681e3fe6e.yml`;
    // A path longer than the 100-byte name field, written through a pax `path` record.
    const huntPath = `${ROOT}/data/nc/executive/Rachel-Hunt-4c3a1120-2dd5-4fbe-a084-e64894e57163.yml`;
    const archive = buildTarGz(
      [
        { path: steinPath, body: stein, pathBy: 'prefix' },
        { path: huntPath, body: hunt, pathBy: 'pax' },
        { path: `${ROOT}/data/nc/legislature/Fixture-Person.yml`, body: 'id: skipped\n' },
        { path: `${ROOT}/README.md`, body: 'Fixture readme\n' },
      ],
      { comment: COMMIT },
    );
    const { entries, global } = await collect(
      archive,
      (path) => path.endsWith('.yml') && path.includes('/executive/'),
    );
    expect(entries.map((entry) => entry.path)).toEqual([steinPath, huntPath]);
    expect(Buffer.from(entries[0]?.bytes ?? []).equals(Buffer.from(stein))).toBe(true);
    expect(Buffer.from(entries[1]?.bytes ?? []).equals(Buffer.from(hunt))).toBe(true);
    expect(global.map((records) => records.get('comment'))).toEqual([COMMIT]);
  });

  it('reads GNU long names and the ustar prefix', async () => {
    const long = `${ROOT}/data/zz/executive/${'y'.repeat(120)}.yml`;
    const prefixed = `${ROOT}/data/zz/executive/Fixture-Prefixed.yml`;
    const archive = buildTarGz([
      { path: long, body: 'a', pathBy: 'gnu' },
      { path: prefixed, body: 'bb', pathBy: 'prefix' },
    ]);
    const { entries } = await collect(archive, () => true);
    expect(entries.map((entry) => [entry.path, entry.bytes.byteLength])).toEqual([
      [long, 1],
      [prefixed, 2],
    ]);
  });

  it('refuses an archive cut inside an entry', async () => {
    const archive = buildTarGz([{ path: `${ROOT}/a.yml`, body: 'x'.repeat(2000) }]);
    const { gunzipSync, gzipSync } = await import('node:zlib');
    const cut = gzipSync(gunzipSync(archive).subarray(0, 1536));
    await expect(collect(cut, () => true)).rejects.toBeInstanceOf(TarFormatError);
  });
});

describe('parseExecutive', () => {
  it('keeps only the listed keys', async () => {
    const text = Buffer.from((await saved(HUNT)).bytes).toString('utf8');
    const person = parseExecutive(text, 'nc');
    expect(person).not.toBeNull();
    expect(Object.keys(person ?? {}).sort()).toEqual([
      'familyName',
      'givenName',
      'id',
      'links',
      'name',
      'party',
      'roles',
      'sources',
      'state',
    ]);
    expect(person).toMatchObject({
      id: 'ocd-person/4c3a1120-2dd5-4fbe-a084-e64894e57163',
      state: 'NC',
      name: 'Rachel Hunt',
      givenName: 'Rachel',
      familyName: 'Hunt',
      party: 'Democratic',
    });
    expect(person?.roles).toContainEqual({
      type: 'lt_governor',
      startDate: '2025-01-01',
      endDate: '2029-01-01',
    });
    // An unquoted date is read as the same calendar date.
    expect(person?.roles).toContainEqual({
      type: 'upper',
      startDate: '2023-01-01',
      endDate: '2025-01-01',
    });
    // The image is never read (D-313).
    expect(JSON.stringify(person)).not.toContain('LG_Headshot');
    expect(person?.links).toContain('https://ltgov.nc.gov/');
  });

  it('a file that is not an executive file gives null', () => {
    expect(parseExecutive('name: [unclosed', 'nc')).toBeNull();
    expect(parseExecutive('id: not-an-ocd-id\nname: Fixture\n', 'nc')).toBeNull();
  });
});

describe('executiveOfficeType', () => {
  it('maps the four executive roles and nothing else', () => {
    expect(executiveOfficeType('lt_governor')).toBe('lieutenant_governor');
    expect(executiveOfficeType('Lieutenant Governor')).toBe('lieutenant_governor');
    expect(executiveOfficeType('governor')).toBe('governor');
    expect(executiveOfficeType('secretary of state')).toBe('secretary-of-state');
    expect(executiveOfficeType('secretary_of_state')).toBe('secretary-of-state');
    expect(executiveOfficeType('attorney general')).toBe('attorney-general');
    expect(executiveOfficeType('attorney_general')).toBe('attorney-general');
    expect(executiveOfficeType('upper')).toBeNull();
    expect(executiveOfficeType('treasurer')).toBeNull();
  });

  it('a role ended yesterday is not current', () => {
    const today = '2026-11-26';
    expect(isCurrentRole({ startDate: '2025-01-01', endDate: '2026-11-25' }, today)).toBe(false);
    expect(isCurrentRole({ startDate: '2025-01-01', endDate: '2026-11-26' }, today)).toBe(true);
    expect(isCurrentRole({ startDate: null, endDate: null }, today)).toBe(true);
    expect(isCurrentRole({ startDate: '2026-11-27', endDate: null }, today)).toBe(false);
  });
});

describe('loadExecutives', () => {
  const governor = zzExecutiveYaml({
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Fixture Governor Person',
    given: 'Fixture',
    family: 'Person',
    role: 'governor',
    start: '2025-01-01',
  });

  function run(answerTarball: boolean, comment: string) {
    const bucket = createMemoryBucket();
    const archive = buildTarGz(
      [
        { path: `${ROOT}/data/zz/executive/Fixture-Governor-Person.yml`, body: governor },
        { path: `${ROOT}/data/zz/legislature/Fixture-Other.yml`, body: governor },
      ],
      { comment },
    );
    const fetcher = scriptFetcher(bucket, (req) => {
      if (req.url === OPENSTATES_PEOPLE_COMMIT_URL) {
        return { body: JSON.stringify({ sha: COMMIT }), contentType: 'application/json' };
      }
      if (req.url === OPENSTATES_PEOPLE_TARBALL && answerTarball) {
        return { body: archive, contentType: 'application/x-gzip' };
      }
      return answerTarball ? undefined : { kind: 'disallowed', reason: 'robots' };
    });
    return { bucket, fetcher, ctx: s09Context(bucket, fetcher) };
  }

  it('reads the executive files of the tarball at the API commit, once per run', async () => {
    const { fetcher, ctx } = run(true, COMMIT);
    const loaded = await loadExecutives(ctx);
    expect(loaded).toMatchObject({ edition: COMMIT, commit: COMMIT, invalid: 0 });
    expect(loaded.key).toBe(`datasets/openstates-people/${COMMIT}/main.tar.gz`);
    expect(loaded.people.map((person) => [person.state, person.name])).toEqual([
      ['ZZ', 'Fixture Governor Person'],
    ]);
    await loadExecutives(ctx);
    expect(fetcher.requests.map((r) => [r.mode, r.req.url])).toEqual([
      ['fetch', OPENSTATES_PEOPLE_COMMIT_URL],
      ['download', OPENSTATES_PEOPLE_TARBALL],
    ]);
  });

  it('takes the tarball comment as the commit when it moved', async () => {
    const moved = 'a'.repeat(40);
    const { ctx } = run(true, moved);
    const loaded = await loadExecutives(ctx);
    expect(loaded).toMatchObject({ edition: COMMIT, commit: moved });
  });

  it('a refused tarball with no earlier copy is unavailable', async () => {
    const { ctx } = run(false, COMMIT);
    await expect(loadExecutives(ctx)).rejects.toBeInstanceOf(DatasetUnavailableError);
  });

  it('matches only executive files', () => {
    expect(EXECUTIVE_PATH.test(`${ROOT}/data/nc/executive/Josh-Stein.yml`)).toBe(true);
    expect(EXECUTIVE_PATH.test(`${ROOT}/data/nc/legislature/Fixture.yml`)).toBe(false);
    expect(EXECUTIVE_PATH.test(`${ROOT}/data/nc/executive/sub/Fixture.yml`)).toBe(false);
  });
});
