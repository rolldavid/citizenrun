import {
  captureLogs,
  getTestBucket,
  getTestObject,
  listTestKeys,
  resetStorage,
} from '@citizenrun/db/testing';
import { createLogger, newId } from '@citizenrun/shared';
import { keyedHash, loadKeyRing } from '@citizenrun/shared/crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { headObject } from './bucket-ops.ts';
import { InvalidReplayEntryError, writeReplayEntry } from './replay.ts';
import type { DeletionReplayEntry, ModerationReplayEntry } from './replay.ts';

const JOB_ID = '0195d2c4-7a10-7c3e-9a51-2f4c8b6d1e07';
const AT = '2027-03-05T23:59:00.000Z';
const USER_HASH = keyedHash(loadKeyRing('0123456789abcdef'.repeat(4), null), {
  kind: 'user',
  userId: '0195d2c4-0000-7000-8000-000000000001',
});

const DELETION: DeletionReplayEntry = {
  v: 1,
  kind: 'account_deleted',
  userHash: USER_HASH,
  at: AT,
};
const MODERATION: ModerationReplayEntry = {
  v: 1,
  kind: 'user_suspended',
  targetType: 'user',
  targetId: null,
  userHash: USER_HASH,
  reason: 'under_18',
  at: AT,
};

function text(bytes: Uint8Array | null): string | null {
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

beforeEach(async () => {
  await resetStorage();
});

describe('the replay writer', () => {
  it('writes a deletion entry under the date of its time', async () => {
    expect(USER_HASH).toMatch(/^[0-9a-f]{64}$/);
    const backups = await getTestBucket('backups');
    const log = createLogger({ service: 'worker', level: 'debug', sink: captureLogs().sink });

    await writeReplayEntry(backups, 'replay/deletions', JOB_ID, DELETION, log);

    const key = `replay/deletions/2027-03-05/${JOB_ID}.json`;
    expect(await listTestKeys('backups', 'replay/')).toEqual([key]);
    expect(text(await getTestObject('backups', key))).toBe(
      `{"v":1,"kind":"account_deleted","userHash":"${USER_HASH}","at":"2027-03-05T23:59:00.000Z"}`,
    );
    expect((await headObject(backups, key))?.contentType).toBe('application/json');
    const written = captureLogs().lines.filter((line) => line.parsed.event === 'replay.written');
    expect(written.map((line) => line.parsed.prefix)).toEqual(['replay/deletions']);
    expect(captureLogs().lines.some((line) => line.raw.includes(USER_HASH))).toBe(false);
    expect(captureLogs().lines.some((line) => line.raw.includes(JOB_ID))).toBe(false);
  });

  it('a retry writes the same bytes', async () => {
    const backups = await getTestBucket('backups');
    const key = `replay/deletions/2027-03-05/${JOB_ID}.json`;
    await writeReplayEntry(backups, 'replay/deletions', JOB_ID, DELETION);
    const first = await getTestObject('backups', key);
    // The same entry with its keys in another order writes the same bytes.
    const reordered = { at: AT, userHash: USER_HASH, kind: 'account_deleted', v: 1 } as const;
    await writeReplayEntry(backups, 'replay/deletions', JOB_ID, reordered);
    const second = await getTestObject('backups', key);

    expect(await listTestKeys('backups', 'replay/')).toEqual([key]);
    expect(second).toEqual(first);
  });

  it('refuses an entry that does not fit its prefix', async () => {
    const backups = await getTestBucket('backups');
    const refused: [string, () => Promise<void>][] = [
      [
        'moderation under deletions',
        () => writeReplayEntry(backups, 'replay/deletions', JOB_ID, MODERATION),
      ],
      [
        'deletion under moderation',
        () => writeReplayEntry(backups, 'replay/moderation', JOB_ID, DELETION),
      ],
      [
        'a user hash that is a uuid',
        () =>
          writeReplayEntry(backups, 'replay/deletions', JOB_ID, { ...DELETION, userHash: newId() }),
      ],
      [
        'a job id that is not a uuid',
        () => writeReplayEntry(backups, 'replay/deletions', 'not-a-job-id', DELETION),
      ],
      [
        'a time with an offset',
        () =>
          writeReplayEntry(backups, 'replay/deletions', JOB_ID, {
            ...DELETION,
            at: '2027-03-05T23:59:00.000-05:00',
          }),
      ],
      [
        'an extra key',
        () =>
          writeReplayEntry(backups, 'replay/deletions', JOB_ID, {
            ...DELETION,
            userId: newId(),
          } as DeletionReplayEntry), // an entry with a key the shape refuses
      ],
    ];
    for (const [name, write] of refused) {
      await expect(write(), name).rejects.toBeInstanceOf(InvalidReplayEntryError);
    }
    expect(await listTestKeys('backups', 'replay/')).toEqual([]);
  });

  it('writes a moderation entry', async () => {
    const backups = await getTestBucket('backups');

    await writeReplayEntry(backups, 'replay/moderation', JOB_ID, MODERATION);

    const key = `replay/moderation/2027-03-05/${JOB_ID}.json`;
    expect(await listTestKeys('backups', 'replay/')).toEqual([key]);
    expect(text(await getTestObject('backups', key))).toBe(
      `{"v":1,"kind":"user_suspended","targetType":"user","targetId":null,"userHash":"${USER_HASH}","reason":"under_18","at":"2027-03-05T23:59:00.000Z"}`,
    );
  });
});
