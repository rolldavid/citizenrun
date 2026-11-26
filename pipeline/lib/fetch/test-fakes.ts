// Fakes for the fetch layer's tests: a clock whose sleep moves time, a transport that records
// every request and answers from a script, and a fetcher built on a temporary state folder.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@citizenrun/shared';
import type { Logger } from '@citizenrun/shared';
import type { DataBucket } from '../bucket.ts';
import { repoRoot } from '../paths.ts';
import { createMemoryBucket } from '../../testing/memory-bucket.ts';
import type { Clock } from './clock.ts';
import { createFetcher } from './fetcher.ts';
import type { FetcherDeps, PipelineFetcher } from './fetcher.ts';
import type { SourceHostRules } from './hosts.ts';
import type { Transport, TransportRequest, TransportResponse } from './transport.ts';
import { userAgent } from './user-agent.ts';

/** A clock that never moves by itself; `sleep` moves it forward and yields to pending I/O. */
export class TestClock implements Clock {
  t: number;
  readonly sleeps: number[] = [];

  constructor(start: number | string = Date.now()) {
    this.t = typeof start === 'number' ? start : Date.parse(start);
  }

  now(): number {
    return this.t;
  }

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.t += ms;
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  }

  set(at: number | string): void {
    this.t = typeof at === 'number' ? at : Date.parse(at);
  }
}

/** One scripted answer. `body` is sent in chunks of `chunkSize` bytes. */
export type Scripted = {
  status: number;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  chunkSize?: number;
};

export type Handler = (
  req: TransportRequest,
  url: URL,
) => Scripted | 'network_error' | Promise<Scripted | 'network_error'>;

export type Recorded = {
  url: string;
  host: string;
  path: string;
  method: string;
  headers: Readonly<Record<string, string>>;
  startedAt: number;
  endedAt: number | null;
};

/** Records every request, its start and end on the clock, and how many were open per host. */
export class FakeTransport implements Transport {
  readonly requests: Recorded[] = [];
  readonly maxOpenPerHost = new Map<string, number>();
  readonly #open = new Map<string, number>();
  readonly #clock: Clock;
  readonly #handler: Handler;

  constructor(clock: Clock, handler: Handler) {
    this.#clock = clock;
    this.#handler = handler;
  }

  /** The requests to `host` other than robots.txt. */
  pages(host?: string): Recorded[] {
    return this.requests.filter(
      (req) => req.path !== '/robots.txt' && (host === undefined || req.host === host),
    );
  }

  robots(host?: string): Recorded[] {
    return this.requests.filter(
      (req) => req.path === '/robots.txt' && (host === undefined || req.host === host),
    );
  }

  async send(req: TransportRequest): Promise<TransportResponse> {
    const url = new URL(req.url);
    const record: Recorded = {
      url: req.url,
      host: url.hostname,
      path: url.pathname,
      method: req.method,
      headers: req.headers,
      startedAt: this.#clock.now(),
      endedAt: null,
    };
    this.requests.push(record);
    const open = (this.#open.get(record.host) ?? 0) + 1;
    this.#open.set(record.host, open);
    this.maxOpenPerHost.set(record.host, Math.max(this.maxOpenPerHost.get(record.host) ?? 0, open));
    let ended = false;
    const end = () => {
      if (!ended) {
        ended = true;
        record.endedAt = this.#clock.now();
        this.#open.set(record.host, (this.#open.get(record.host) ?? 1) - 1);
      }
    };
    req.signal.addEventListener('abort', end, { once: true });
    // Let other work run while the request is open.
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    const answer = await this.#handler(req, url);
    if (answer === 'network_error') {
      end();
      throw new TypeError('fetch failed');
    }
    const bytes =
      answer.body === undefined
        ? new Uint8Array(0)
        : typeof answer.body === 'string'
          ? new TextEncoder().encode(answer.body)
          : answer.body;
    const chunkSize = answer.chunkSize ?? 16_384;
    async function* chunks(): AsyncGenerator<Uint8Array> {
      try {
        for (let at = 0; at < bytes.byteLength; at += chunkSize) {
          await Promise.resolve();
          yield bytes.subarray(at, at + chunkSize);
        }
      } finally {
        end();
      }
    }
    return {
      status: answer.status,
      headers: new Headers(answer.headers ?? {}),
      body: chunks(),
    };
  }
}

/** A robots.txt answer: 404 (no file) unless the test gives one. */
export function robotsAnswer(url: URL, files: Readonly<Record<string, Scripted>> = {}): Scripted {
  return files[url.hostname] ?? { status: 404, body: 'not found' };
}

export function quietLogger(): Logger {
  return createLogger({ service: 'pipeline', level: 'error', sink: () => undefined });
}

const stateDirs: string[] = [];

/** A temporary state folder; never the real shared folder. */
export async function tempStateDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fetch-'));
  stateDirs.push(dir);
  return dir;
}

/** Removes every temporary state folder made so far. */
export async function removeStateDirs(): Promise<void> {
  for (const dir of stateDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
}

export const EMPTY_RULES: SourceHostRules = { forbiddenHosts: [], resultsHosts: [] };

export type TestFetcher = {
  fetcher: PipelineFetcher;
  transport: FakeTransport;
  clock: TestClock;
  bucket: DataBucket;
  stateDir: string;
};

/** A real fetcher over a fake transport, a test clock, a memory bucket and a temporary folder. */
export async function makeFetcher(opts: {
  handler: Handler;
  clock?: TestClock;
  transport?: FakeTransport;
  bucket?: DataBucket;
  stateDir?: string;
  log?: Logger;
  isCi?: boolean;
  hostRules?: SourceHostRules;
  zoneForState?: FetcherDeps['zoneForState'];
  electionDatesForState?: FetcherDeps['electionDatesForState'];
}): Promise<TestFetcher> {
  const clock = opts.clock ?? new TestClock();
  const transport = opts.transport ?? new FakeTransport(clock, opts.handler);
  const bucket = opts.bucket ?? createMemoryBucket();
  const stateDir = opts.stateDir ?? (await tempStateDir());
  const fetcher = createFetcher({
    transport,
    clock,
    bucket,
    log: opts.log ?? quietLogger(),
    isCi: opts.isCi ?? false,
    userAgent: userAgent('0.0.0'),
    repoRoot: repoRoot(),
    hostRules: opts.hostRules ?? EMPTY_RULES,
    zoneForState: opts.zoneForState ?? (() => null),
    electionDatesForState: opts.electionDatesForState ?? (() => []),
    stateDir,
  });
  return { fetcher, transport, clock, bucket, stateDir };
}
