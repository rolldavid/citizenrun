// The owner's fetch of the URLs that hosts refused to CI runners (PIPE-local-fetch; D-087, D-326).
// It uses the same fetcher, so every rule of the crawl policy holds; it never changes address.
import {
  logSnapshotOutcome,
  runSnapshots,
  snapshotsExitCode,
  storeSnapshot,
} from '../crawlers/archiver.ts';
import type { SnapshotOutcome } from '../crawlers/archiver.ts';
import type { SnapshotSource } from './data-files.ts';
import type { BrowserSession } from './fetch/browser.ts';
import { HostRegistry, readQueue, removeFromQueue } from './fetch/hosts.ts';
import type { QueueEntry } from './fetch/hosts.ts';
import type { RunContext } from './runner.ts';

/** The purpose of a queued URL whose body only has to reach the raw cache. */
const CACHE_PURPOSE = 'cache';
/** A queued candidate list: it goes only to that source's raw/filings/ folder (7.1 rule 8). */
const SNAPSHOT_PURPOSE = /^snapshot:([a-z0-9][a-z0-9-]*)$/;

type Step = 'fetched' | 'left' | 'stopped';

/** One queued URL, finished as the CI run would have finished it. */
async function finishQueued(ctx: RunContext, entry: QueueEntry, host: string): Promise<Step> {
  const snapshot = SNAPSHOT_PURPOSE.exec(entry.purpose);
  if (snapshot !== null) {
    const source = snapshot[1] ?? '';
    if (entry.state === null) {
      ctx.log.warn('local_fetch.snapshot_without_state', { host, source });
      return 'left';
    }
    let outcome: SnapshotOutcome;
    try {
      outcome = await storeSnapshot(ctx, {
        source,
        state: entry.state,
        url: entry.url,
        part: null,
      });
    } catch {
      outcome = { source, state: entry.state, result: 'error', reason: 'exception', bytes: null };
    }
    logSnapshotOutcome(ctx.log, outcome);
    switch (outcome.result) {
      case 'saved':
      case 'unchanged':
        return 'fetched';
      case 'challenge':
        return 'stopped';
      case 'refused':
      case 'disallowed':
      case 'error':
      case 'skipped':
        return 'left';
    }
  }
  if (entry.purpose !== CACHE_PURPOSE) {
    ctx.log.warn('local_fetch.unknown_purpose', { host, purpose: entry.purpose });
    return 'left';
  }
  const result = await ctx.fetcher.fetch({
    url: entry.url,
    class: entry.class,
    purpose: entry.purpose,
    ...(entry.state === null ? {} : { state: entry.state }),
  });
  switch (result.kind) {
    case 'ok':
    case 'not_modified':
      // The body is in the raw cache; the next CI run parses from it.
      return 'fetched';
    case 'challenge':
      return 'stopped';
    case 'disallowed':
    case 'error':
      return 'left';
  }
}

export async function runLocalFetch(
  ctx: RunContext,
  opts: {
    state: string | null;
    /** The entries of data/snapshot-sources.yaml; those marked `blocked: true` are taken here. */
    snapshots: readonly SnapshotSource[];
    browser: () => Promise<BrowserSession>;
  },
): Promise<{ exitCode: 0 | 1; fetched: number; left: number }> {
  const registry = new HostRegistry(ctx.bucket);
  await registry.load();
  const hosts = registry.blockedHosts();
  if (hosts.length === 0) {
    ctx.log.info('local_fetch.none');
  }
  let exitCode: 0 | 1 = 0;
  let fetched = 0;
  let left = 0;
  for (const host of hosts) {
    const queue = await readQueue(ctx.bucket, host);
    let hostFetched = 0;
    let hostLeft = 0;
    let stopped = false;
    for (const entry of queue) {
      if (opts.state !== null && entry.state !== opts.state) {
        continue;
      }
      if (stopped) {
        hostLeft += 1;
        continue;
      }
      const step = await finishQueued(ctx, entry, host);
      switch (step) {
        case 'fetched':
          await removeFromQueue(ctx.bucket, host, [entry.url]);
          hostFetched += 1;
          break;
        case 'stopped':
          // The host refused this machine too: it stops for this run and keeps its queue.
          stopped = true;
          exitCode = 1;
          hostLeft += 1;
          break;
        case 'left':
          hostLeft += 1;
          break;
      }
    }
    ctx.log.info('local_fetch.host', { host, fetched: hostFetched, left: hostLeft, stopped });
    fetched += hostFetched;
    left += hostLeft;
  }

  // Snapshot sources whose host refuses CI runners are attempted only here (PIPE-snapshot-archiver).
  const blocked = opts.snapshots.filter((entry) => entry.blocked === true);
  if (blocked.length > 0) {
    const outcomes = await runSnapshots(ctx, blocked, {
      includeBlocked: true,
      states: opts.state === null ? 'all' : [opts.state],
      browser: opts.browser,
    });
    if (snapshotsExitCode(outcomes) === 1) {
      exitCode = 1;
    }
  }
  ctx.log.info('local_fetch.done', { hosts: hosts.length, fetched, left, exitCode });
  return { exitCode, fetched, left };
}
