// The owner's fetch of the URLs that hosts refused to CI runners (PIPE-local-fetch; D-087, D-326).
// It uses the same fetcher, so every rule of the crawl policy holds; it never changes address.
import { HostRegistry, readQueue, removeFromQueue } from './fetch/hosts.ts';
import type { RunContext } from './runner.ts';

/** The purpose of a queued URL whose body only has to reach the raw cache. */
const CACHE_PURPOSE = 'cache';

export async function runLocalFetch(
  ctx: RunContext,
  opts: { state: string | null },
): Promise<{ exitCode: 0 | 1; fetched: number; left: number }> {
  const registry = new HostRegistry(ctx.bucket);
  await registry.load();
  const hosts = registry.blockedHosts();
  if (hosts.length === 0) {
    ctx.log.info('local_fetch.none');
    return { exitCode: 0, fetched: 0, left: 0 };
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
      if (entry.purpose !== CACHE_PURPOSE) {
        ctx.log.warn('local_fetch.unknown_purpose', { host, purpose: entry.purpose });
        hostLeft += 1;
        continue;
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
          await removeFromQueue(ctx.bucket, host, [entry.url]);
          hostFetched += 1;
          break;
        case 'challenge':
          // The host refused this machine too: it stops for this run and keeps its queue.
          stopped = true;
          exitCode = 1;
          hostLeft += 1;
          break;
        case 'disallowed':
        case 'error':
          hostLeft += 1;
          break;
      }
    }
    ctx.log.info('local_fetch.host', { host, fetched: hostFetched, left: hostLeft, stopped });
    fetched += hostFetched;
    left += hostLeft;
  }
  ctx.log.info('local_fetch.done', { hosts: hosts.length, fetched, left, exitCode });
  return { exitCode, fetched, left };
}
