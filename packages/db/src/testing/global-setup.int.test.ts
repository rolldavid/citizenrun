import { randomBytes } from 'node:crypto';
import { describe, expect, inject, it } from 'vitest';
import { dropStale } from './global-setup.ts';
import { lastUsedComment, stampOf, templateName } from './names.ts';
import { connectHarnessClient, dropDatabase, harnessSettings } from './settings.ts';

const DAY_MS = 24 * 60 * 60_000;

describe('dropStale', () => {
  it('ages a template by its last use, not by when it was built', async () => {
    const now = new Date();
    const at = (daysAgo: number): string => stampOf(new Date(now.getTime() - daysAgo * DAY_MS));
    const planted = (daysAgo: number): string =>
      templateName(at(daysAgo), randomBytes(6).toString('hex'));
    const usedNow = planted(9);
    const neverMarked = planted(9);
    const usedLongAgo = planted(9);
    const builtRecently = planted(6);
    const names = [usedNow, neverMarked, usedLongAgo, builtRecently];
    const admin = await connectHarnessClient(harnessSettings().databaseUrl, 'os-test-stale');
    try {
      for (const name of names) {
        await admin.query(`create database ${admin.escapeIdentifier(name)}`);
      }
      const comment = async (name: string, daysAgo: number): Promise<void> => {
        await admin.query(
          `comment on database ${admin.escapeIdentifier(name)} is ${admin.escapeLiteral(lastUsedComment(at(daysAgo)))}`,
        );
      };
      await comment(usedNow, 0);
      await comment(usedLongAgo, 8);

      // dropStale runs under the template lock, as in the global setup of every run.
      await admin.query("select pg_advisory_lock(hashtext('os_test_template'))");
      try {
        await dropStale(admin, now, inject('harness').templateName);
      } finally {
        await admin.query("select pg_advisory_unlock(hashtext('os_test_template'))");
      }

      const left = await admin.query<{ datname: string }>(
        'select datname from pg_database where datname = any($1::text[]) order by datname',
        [names],
      );
      expect(left.rows.map((row) => row.datname)).toEqual([usedNow, builtRecently].sort());
    } finally {
      for (const name of names) {
        await dropDatabase(admin, name);
      }
      await admin.end();
    }
  });
});
