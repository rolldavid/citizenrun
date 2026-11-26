// Forbidden hosts (D-331) and the blocked-host registry with its queue (PIPE-host-registry).
import { IsoInstantSchema } from '@citizenrun/shared';
import { z } from 'zod';
import { bucketKeys } from '../bucket.ts';
import type { DataBucket } from '../bucket.ts';
import type { FetchClass } from './types.ts';

/** Never requested, whatever the registers say (D-325: robots.txt disallows everything). */
export const NEVER_FETCHED_HOSTS = ['elections.il.gov'] as const;

/** A blocked host is tried again from CI once this long has passed. */
export const BLOCKED_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

export type SourceHostRules = {
  readonly forbiddenHosts: readonly string[];
  readonly resultsHosts: readonly string[];
};

/** True when `host` is `listed` or a subdomain of it. */
export function hostIsOrUnder(host: string, listed: string): boolean {
  const h = host.toLowerCase();
  const l = listed.toLowerCase();
  return h === l || h.endsWith(`.${l}`);
}

/** A forbidden source's host, a subdomain of one, or a never-fetched host. */
export function isForbiddenHost(host: string, rules: SourceHostRules): boolean {
  return [...rules.forbiddenHosts, ...NEVER_FETCHED_HOSTS].some((listed) =>
    hostIsOrUnder(host, listed),
  );
}

const HostEntrySchema = z.strictObject({
  status: z.enum(['ok', 'blocked_from_ci']),
  since: IsoInstantSchema,
  last_status: z.int().min(0).max(999).nullable(),
  last_checked_at: IsoInstantSchema,
  reason: z.enum(['challenge', 'first_request_403', 'repeated_429']).nullable(),
});
export type HostEntry = z.infer<typeof HostEntrySchema>;
export type BlockReason = NonNullable<HostEntry['reason']>;

/** `pipeline-state/hosts.json`. */
export const HostRegistrySchema = z.record(z.string(), HostEntrySchema);
export type HostRegistryFile = z.infer<typeof HostRegistrySchema>;

/** The registry of hosts that blocked a CI runner. One process reads and writes it at a time. */
export class HostRegistry {
  readonly #bucket: DataBucket;
  #hosts: Record<string, HostEntry> = {};

  constructor(bucket: DataBucket) {
    this.#bucket = bucket;
  }

  async load(): Promise<void> {
    this.#hosts = {
      ...((await this.#bucket.getJson(bucketKeys.hosts(), HostRegistrySchema)) ?? {}),
    };
  }

  entry(host: string): HostEntry | null {
    return this.#hosts[host.toLowerCase()] ?? null;
  }

  /** The hosts marked `blocked_from_ci`, in byte order. */
  blockedHosts(): readonly string[] {
    return Object.entries(this.#hosts)
      .filter(([, entry]) => entry.status === 'blocked_from_ci')
      .map(([host]) => host)
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  }

  /** Blocked and marked less than 30 days ago; after that one request is allowed and recorded. */
  isBlocked(host: string, nowMs: number): boolean {
    const found = this.entry(host);
    return (
      found !== null &&
      found.status === 'blocked_from_ci' &&
      nowMs - Date.parse(found.since) < BLOCKED_RETRY_MS
    );
  }

  markBlocked(host: string, status: number, reason: BlockReason, nowIso: string): void {
    this.#hosts[host.toLowerCase()] = {
      status: 'blocked_from_ci',
      since: nowIso,
      last_status: status,
      last_checked_at: nowIso,
      reason,
    };
  }

  markOk(host: string, status: number, nowIso: string): void {
    const found = this.entry(host);
    this.#hosts[host.toLowerCase()] = {
      status: 'ok',
      since: found !== null && found.status === 'ok' ? found.since : nowIso,
      last_status: status,
      last_checked_at: nowIso,
      reason: null,
    };
  }

  async save(): Promise<void> {
    await this.#bucket.putJson(bucketKeys.hosts(), this.#hosts, HostRegistrySchema);
  }
}

const FETCH_CLASSES = [
  'dataset',
  'adapter',
  'crawl',
  'api',
] as const satisfies readonly FetchClass[];

const QueueEntrySchema = z.strictObject({
  url: z.string().min(1).max(4096),
  class: z.enum(FETCH_CLASSES),
  state: z.string().nullable(),
  purpose: z.string().min(1).max(200),
  queued_at: IsoInstantSchema,
});
export type QueueEntry = z.infer<typeof QueueEntrySchema>;

/** `pipeline-state/fetch-queue/<host>.json`: the URLs waiting for the local fetch. */
export const FetchQueueSchema = z.array(QueueEntrySchema);

export async function readQueue(bucket: DataBucket, host: string): Promise<QueueEntry[]> {
  return [
    ...((await bucket.getJson(bucketKeys.fetchQueue(host.toLowerCase()), FetchQueueSchema)) ?? []),
  ];
}

/** Appends `entry` unless its URL is already queued. */
export async function queueForLocalFetch(
  bucket: DataBucket,
  host: string,
  entry: QueueEntry,
): Promise<void> {
  const queue = await readQueue(bucket, host);
  if (queue.some((queued) => queued.url === entry.url)) {
    return;
  }
  queue.push(entry);
  await bucket.putJson(bucketKeys.fetchQueue(host.toLowerCase()), queue, FetchQueueSchema);
}

/** Removes the entries for `urls`; an emptied queue is deleted. */
export async function removeFromQueue(
  bucket: DataBucket,
  host: string,
  urls: readonly string[],
): Promise<void> {
  const key = bucketKeys.fetchQueue(host.toLowerCase());
  const drop = new Set(urls);
  const queue = await readQueue(bucket, host);
  const kept = queue.filter((entry) => !drop.has(entry.url));
  if (kept.length === queue.length) {
    return;
  }
  if (kept.length === 0) {
    await bucket.delete([key]);
    return;
  }
  await bucket.putJson(key, kept, FetchQueueSchema);
}
