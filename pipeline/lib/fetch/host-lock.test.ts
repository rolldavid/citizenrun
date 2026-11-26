import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, utimes, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BRAND } from '@citizenrun/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { DAILY_CAP, HostLock, MIN_GAP_MS, fetchStateDir, readDayCount } from './host-lock.ts';
import { HostLimiter } from './rate.ts';
import { TestClock, removeStateDirs, tempStateDir } from './test-fakes.ts';

const HOST = 'a.example.test';
const TODAY = '2026-11-26';

afterEach(async () => {
  await removeStateDirs();
});

/** The pid of a child process that has already exited. */
async function endedPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise<void>((resolve) => {
    child.on('exit', () => {
      resolve();
    });
  });
  if (child.pid === undefined) {
    throw new Error('no child pid');
  }
  return child.pid;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

describe('two seconds per host', () => {
  it('two limiters on one folder never hold one host at once', async () => {
    const dir = await tempStateDir();
    const clock = new TestClock();
    const first = new HostLimiter(clock, new HostLock(dir, clock));
    const second = new HostLimiter(clock, new HostLock(dir, clock));
    const releaseFirst = await first.acquire(HOST, TODAY);
    const seen: { at: number | null } = { at: null };
    const secondTake = second.acquire(HOST, TODAY).then((release) => {
      seen.at = clock.now();
      return release;
    });
    await settle();
    expect(seen.at).toBeNull();
    const releasedAt = clock.now();
    releaseFirst();
    const releaseSecond = await secondTake;
    expect(seen.at).not.toBeNull();
    expect((seen.at ?? 0) - releasedAt).toBeGreaterThanOrEqual(MIN_GAP_MS);
    releaseSecond();
    expect(await readDayCount(dir, HOST, TODAY)).toBe(2);
  });

  it('a lock whose owner process has ended is taken', async () => {
    const dir = await tempStateDir();
    const clock = new TestClock();
    const lockDir = join(dir, 'locks', HOST);
    await mkdir(lockDir, { recursive: true });
    await writeFile(join(lockDir, 'owner'), `${String(await endedPid())}\n`);
    const taken = await new HostLock(dir, clock).take(HOST, TODAY);
    expect(taken).not.toBe('daily_cap');
    expect(clock.sleeps).toEqual([]);
    expect(await readFile(join(lockDir, 'owner'), 'utf8')).toBe(String(process.pid));
  });

  it('a lock folder without owner older than 60 seconds is taken', async () => {
    const dir = await tempStateDir();
    const clock = new TestClock(Math.floor(Date.now() / 1000) * 1000);
    const lockDir = join(dir, 'locks', HOST);
    await mkdir(lockDir, { recursive: true });
    const old = new Date(clock.now() - 61_000);
    await utimes(lockDir, old, old);
    expect(await new HostLock(dir, clock).take(HOST, TODAY)).not.toBe('daily_cap');
    expect(clock.sleeps).toEqual([]);

    // At 59 seconds it is not taken: the lock waits until the folder is more than 60 s old.
    const other = await tempStateDir();
    const lockDir2 = join(other, 'locks', HOST);
    await mkdir(lockDir2, { recursive: true });
    const young = new Date(clock.now() - 59_000);
    await utimes(lockDir2, young, young);
    const startedAt = clock.now();
    expect(await new HostLock(other, clock).take(HOST, TODAY)).not.toBe('daily_cap');
    expect(clock.sleeps.length).toBeGreaterThanOrEqual(2);
    expect(clock.now() - startedAt).toBeGreaterThan(1000);
  });

  it('the count is shared and refuses at 2,000', async () => {
    const dir = await tempStateDir();
    const clock = new TestClock();
    await mkdir(join(dir, 'counts', TODAY), { recursive: true });
    await writeFile(join(dir, 'counts', TODAY, HOST), String(DAILY_CAP - 1));
    const taken = await new HostLock(dir, clock).take(HOST, TODAY);
    expect(taken).not.toBe('daily_cap');
    expect(await readFile(join(dir, 'counts', TODAY, HOST), 'utf8')).toBe(String(DAILY_CAP));
    if (taken !== 'daily_cap') {
      taken.release();
    }
    // Another lock on the same folder, as another process has, sees the same count.
    expect(await new HostLock(dir, clock).take(HOST, TODAY)).toBe('daily_cap');
    expect(existsSync(join(dir, 'locks', HOST))).toBe(false);
  });

  it('the count starts again on the next UTC day', async () => {
    const dir = await tempStateDir();
    const clock = new TestClock();
    await mkdir(join(dir, 'counts', TODAY), { recursive: true });
    await writeFile(join(dir, 'counts', TODAY, HOST), String(DAILY_CAP));
    const lock = new HostLock(dir, clock);
    expect(await lock.take(HOST, TODAY)).toBe('daily_cap');
    const next = await lock.take(HOST, '2026-11-27');
    expect(next).not.toBe('daily_cap');
    expect(await readDayCount(dir, HOST, '2026-11-27')).toBe(1);
  });

  it('count folders more than 7 days old are deleted', async () => {
    const dir = await tempStateDir();
    const clock = new TestClock();
    await mkdir(join(dir, 'counts', '2026-11-18'), { recursive: true }); // 8 days before
    await mkdir(join(dir, 'counts', '2026-11-19'), { recursive: true }); // 7 days before
    const taken = await new HostLock(dir, clock).take(HOST, TODAY);
    expect(taken).not.toBe('daily_cap');
    expect((await readdir(join(dir, 'counts'))).sort()).toEqual(['2026-11-19', TODAY]);
  });

  it('fetchStateDir is under the home folder', () => {
    expect(fetchStateDir()).toBe(join(homedir(), `.${BRAND.slug}`, 'fetch'));
  });
});
