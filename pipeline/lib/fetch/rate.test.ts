import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HostLock } from './host-lock.ts';
import { DAILY_CAP, DailyCapError, HostLimiter, MAX_HOSTS_IN_FLIGHT, MIN_GAP_MS } from './rate.ts';
import { TestClock, removeStateDirs, tempStateDir } from './test-fakes.ts';

const TODAY = '2026-11-26';

afterEach(async () => {
  await removeStateDirs();
});

/** Yields until `path` is gone, or gives up after many turns of the event loop. */
async function gone(path: string): Promise<boolean> {
  for (let i = 0; i < 2000 && existsSync(path); i += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
  return !existsSync(path);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }
}

describe('HostLimiter', () => {
  it('keeps the gap between two requests to one host', async () => {
    const dir = await tempStateDir();
    const clock = new TestClock();
    const limiter = new HostLimiter(clock, new HostLock(dir, clock));
    const release = await limiter.acquire('a.example.test', TODAY);
    const releasedAt = clock.now();
    release();
    await limiter.acquire('a.example.test', TODAY);
    expect(clock.now() - releasedAt).toBeGreaterThanOrEqual(MIN_GAP_MS);
    expect(await limiter.requestsToday('a.example.test', TODAY)).toBe(2);
  });

  it('a ninth host waits for an in-process slot', async () => {
    const dir = await tempStateDir();
    const clock = new TestClock();
    const limiter = new HostLimiter(clock, new HostLock(dir, clock));
    const releases: (() => void)[] = [];
    for (let i = 0; i < MAX_HOSTS_IN_FLIGHT; i += 1) {
      releases.push(await limiter.acquire(`h${String(i)}.example.test`, TODAY));
    }
    let ninth = false;
    const pending = limiter.acquire('h8.example.test', TODAY).then((release) => {
      ninth = true;
      return release;
    });
    await settle();
    expect(ninth).toBe(false);
    releases[0]?.();
    (await pending)();
    expect(ninth).toBe(true);
  });

  it('DailyCapError when the lock refuses', async () => {
    const dir = await tempStateDir();
    const clock = new TestClock();
    await mkdir(join(dir, 'counts', TODAY), { recursive: true });
    await writeFile(join(dir, 'counts', TODAY, 'a.example.test'), String(DAILY_CAP));
    const limiter = new HostLimiter(clock, new HostLock(dir, clock));
    await expect(limiter.acquire('a.example.test', TODAY)).rejects.toBeInstanceOf(DailyCapError);
    // The refusal gave its slot back: eight other hosts still fit.
    for (let i = 0; i < MAX_HOSTS_IN_FLIGHT; i += 1) {
      await limiter.acquire(`h${String(i)}.example.test`, TODAY);
    }
  });

  it('a second release does nothing', async () => {
    const dir = await tempStateDir();
    const clock = new TestClock();
    const limiter = new HostLimiter(clock, new HostLock(dir, clock));
    const release = await limiter.acquire('a.example.test', TODAY);
    release();
    release();
    expect(await gone(join(dir, 'locks', 'a.example.test'))).toBe(true);
    expect(clock.sleeps.filter((ms) => ms === MIN_GAP_MS)).toHaveLength(1);
    // Only one slot was given back: with eight hosts held, a ninth still waits.
    const releases: (() => void)[] = [];
    for (let i = 0; i < MAX_HOSTS_IN_FLIGHT; i += 1) {
      releases.push(await limiter.acquire(`h${String(i)}.example.test`, TODAY));
    }
    let ninth = false;
    const pending = limiter.acquire('h8.example.test', TODAY).then((free) => {
      ninth = true;
      return free;
    });
    await settle();
    expect(ninth).toBe(false);
    for (const free of releases) {
      free();
    }
    (await pending)();
    await settle();
  });
});
