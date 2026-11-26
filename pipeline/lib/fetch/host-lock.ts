// The pace and the day's count for every process on one machine (D-331, D-770, D-796):
// one lock folder per host and one count file per host and UTC day, in a folder all of them share.
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BRAND } from '@citizenrun/shared';
import type { Clock } from './clock.ts';

/** Request starts to one host are at least this far apart (D-331). */
export const MIN_GAP_MS = 2000;
/** Requests to one host in one UTC day (D-331). */
export const DAILY_CAP = 2000;
/** A lock folder with no owner file is taken once it is this old. */
export const OWNERLESS_LOCK_MS = 60_000;
/** The wait before a held lock is tried again. */
export const LOCK_RETRY_MS = 500;
/** Count folders more than this many days before today are deleted. */
export const COUNT_DAYS_KEPT = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const HOST = /^[a-z0-9.\-[\]:]+$/u;

/** The shared state folder: outside every checkout and worktree, computed at run time. */
export function fetchStateDir(): string {
  return join(homedir(), `.${BRAND.slug}`, 'fetch');
}

function hostName(host: string): string {
  const lower = host.toLowerCase();
  if (!HOST.test(lower) || lower.includes('..')) {
    throw new Error('not a host name');
  }
  return lower;
}

function errorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
}

function processEnded(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return errorCode(error) === 'ESRCH';
  }
}

async function readCount(file: string): Promise<number> {
  try {
    const value = Number.parseInt((await readFile(file, 'utf8')).trim(), 10);
    return Number.isFinite(value) && value >= 0 ? value : 0;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return 0;
    }
    throw error;
  }
}

/** The day's count for `host` (a missing file counts 0). */
export function readDayCount(dir: string, host: string, today: string): Promise<number> {
  return readCount(join(dir, 'counts', today, hostName(host)));
}

export class HostLock {
  readonly #dir: string;
  readonly #clock: Clock;

  constructor(dir: string, clock: Clock) {
    this.#dir = dir;
    this.#clock = clock;
  }

  /** The shared state folder this lock lives in. */
  get dir(): string {
    return this.#dir;
  }

  /**
   * Takes the host's lock and adds one to the day's count; `'daily_cap'` (with the lock given
   * back) when the count has reached DAILY_CAP.
   */
  async take(host: string, today: string): Promise<{ release(): void } | 'daily_cap'> {
    if (!DATE.test(today)) {
      throw new Error('not a UTC date');
    }
    const name = hostName(host);
    const lockDir = await this.#lock(name);
    try {
      const countFile = join(await this.#dayFolder(today), name);
      const count = await readCount(countFile);
      if (count >= DAILY_CAP) {
        await rm(lockDir, { recursive: true, force: true });
        return 'daily_cap';
      }
      await writeFile(countFile, String(count + 1));
    } catch (error) {
      await rm(lockDir, { recursive: true, force: true });
      throw error;
    }
    let released = false;
    const clock = this.#clock;
    return {
      release() {
        if (released) {
          return;
        }
        released = true;
        // The folder goes MIN_GAP_MS after the request ends; this timer keeps the process alive
        // until then, so no other process starts a request to the host inside the gap.
        void clock
          .sleep(MIN_GAP_MS)
          .then(() => rm(lockDir, { recursive: true, force: true }))
          .catch(() => undefined);
      },
    };
  }

  async #lock(name: string): Promise<string> {
    const locks = join(this.#dir, 'locks');
    await mkdir(locks, { recursive: true });
    const lockDir = join(locks, name);
    for (;;) {
      try {
        // Never recursive: only one process can create the folder.
        await mkdir(lockDir);
        await writeFile(join(lockDir, 'owner'), String(process.pid));
        return lockDir;
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') {
          throw error;
        }
      }
      const held = await this.#held(lockDir);
      if (held === 'gone') {
        continue;
      }
      if (held === 'stale') {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }
      await this.#clock.sleep(LOCK_RETRY_MS);
    }
  }

  /**
   * `stale` when the owner process has ended, or when there is no owner and the folder is more
   * than a minute old; `gone` when the folder went while it was read; else `held`.
   */
  async #held(lockDir: string): Promise<'held' | 'stale' | 'gone'> {
    let owner: string | null;
    try {
      owner = await readFile(join(lockDir, 'owner'), 'utf8');
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        throw error;
      }
      owner = null;
    }
    if (owner !== null) {
      const pid = Number.parseInt(owner.trim().split(/\s+/u)[0] ?? '', 10);
      return Number.isInteger(pid) && pid > 0 && processEnded(pid) ? 'stale' : 'held';
    }
    try {
      const info = await stat(lockDir);
      return info.mtimeMs < this.#clock.now() - OWNERLESS_LOCK_MS ? 'stale' : 'held';
    } catch (error) {
      if (errorCode(error) === 'ENOENT') {
        return 'gone';
      }
      throw error;
    }
  }

  /** The day's count folder; the process that creates it deletes the folders of old days. */
  async #dayFolder(today: string): Promise<string> {
    const counts = join(this.#dir, 'counts');
    await mkdir(counts, { recursive: true });
    const day = join(counts, today);
    try {
      await mkdir(day);
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        return day;
      }
      throw error;
    }
    const todayMs = Date.parse(`${today}T00:00:00.000Z`);
    for (const entry of await readdir(counts)) {
      if (!DATE.test(entry)) {
        continue;
      }
      const at = Date.parse(`${entry}T00:00:00.000Z`);
      if (Number.isFinite(at) && todayMs - at > COUNT_DAYS_KEPT * DAY_MS) {
        await rm(join(counts, entry), { recursive: true, force: true });
      }
    }
    return day;
  }
}
