// robots.txt as RFC 9309 describes it (D-331), written here without a library.
import { IsoInstantSchema } from '@citizenrun/shared';
import { z } from 'zod';
import { bucketKeys } from '../bucket.ts';
import type { DataBucket } from '../bucket.ts';
import type { Clock } from './clock.ts';
import { isChallenge } from './challenge.ts';

/** RFC 9309 asks parsers to read at least 500 KiB. */
export const ROBOTS_MAX_BYTES = 512_000;

/** A stored robots.txt is read again once it is this old (D-331). */
export const ROBOTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type RobotsRules = {
  readonly groups: readonly {
    agents: readonly string[];
    rules: readonly { allow: boolean; pattern: string }[];
  }[];
};

type MutableGroup = { agents: string[]; rules: { allow: boolean; pattern: string }[] };

/** The first ROBOTS_MAX_BYTES bytes of `text`, cut at a character boundary. */
function firstBytes(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength <= ROBOTS_MAX_BYTES) {
    return text;
  }
  return new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, ROBOTS_MAX_BYTES))
    .replace(/�$/u, '');
}

/** Reads a robots.txt body into its groups. */
export function parseRobots(text: string): RobotsRules {
  const groups: MutableGroup[] = [];
  let current: MutableGroup | null = null;
  let lastWasAgent = false;
  for (const rawLine of firstBytes(text).split(/\r\n|\r|\n/u)) {
    const hash = rawLine.indexOf('#');
    const line = (hash === -1 ? rawLine : rawLine.slice(0, hash)).trim();
    const colon = line.indexOf(':');
    if (colon === -1) {
      continue;
    }
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === 'user-agent') {
      if (current === null || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value);
      lastWasAgent = true;
    } else if (key === 'allow' || key === 'disallow') {
      lastWasAgent = false;
      // A rule before any user-agent line belongs to no group; an empty pattern is no rule.
      if (current !== null && value !== '') {
        current.rules.push({ allow: key === 'allow', pattern: value });
      }
    }
    // Every other key (sitemap, crawl-delay, unknown) is ignored.
  }
  return { groups };
}

const UNRESERVED = /^[A-Za-z0-9\-._~]$/u;

/** Percent-escapes upper-cased, unreserved escapes decoded, other non-ASCII text escaped. */
function normalise(value: string): string {
  let ascii = '';
  for (const char of value) {
    if ((char.codePointAt(0) ?? 0) <= 0x7f) {
      ascii += char;
      continue;
    }
    try {
      ascii += encodeURIComponent(char);
    } catch {
      // A lone surrogate has no encoding; it is dropped.
    }
  }
  return ascii.replace(/%([0-9A-Fa-f]{2})/gu, (_match, hex: string) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16));
    return UNRESERVED.test(char) ? char : `%${hex.toUpperCase()}`;
  });
}

/** A robots pattern against a path: `*` is any sequence, a trailing `$` anchors the end. */
function patternMatches(rawPattern: string, path: string): boolean {
  const anchored = rawPattern.endsWith('$');
  const pattern = anchored ? rawPattern.slice(0, -1) : `${rawPattern}*`;
  let p = 0;
  let s = 0;
  let star = -1;
  let mark = 0;
  while (s < path.length) {
    if (p < pattern.length && pattern[p] !== '*' && pattern[p] === path[s]) {
      p += 1;
      s += 1;
    } else if (p < pattern.length && pattern[p] === '*') {
      star = p;
      mark = s;
      p += 1;
    } else if (star !== -1) {
      p = star + 1;
      mark += 1;
      s = mark;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') {
    p += 1;
  }
  return p === pattern.length;
}

/** The decision for one path and query under the groups for `token`, else the `*` groups. */
export function robotsDecision(
  rules: RobotsRules,
  token: string,
  pathAndQuery: string,
): 'allowed' | 'disallowed' {
  if (pathAndQuery === '/robots.txt') {
    return 'allowed';
  }
  const wanted = token.toLowerCase();
  let groups = rules.groups.filter((group) =>
    group.agents.some((agent) => agent.toLowerCase() === wanted),
  );
  if (groups.length === 0) {
    groups = rules.groups.filter((group) => group.agents.includes('*'));
  }
  const path = normalise(pathAndQuery);
  let bestLength = -1;
  let bestAllow = true;
  for (const group of groups) {
    for (const rule of group.rules) {
      const pattern = normalise(rule.pattern);
      if (!patternMatches(pattern, path)) {
        continue;
      }
      const length = Buffer.byteLength(pattern, 'utf8');
      if (length > bestLength || (length === bestLength && rule.allow)) {
        bestLength = length;
        bestAllow = rule.allow;
      }
    }
  }
  return bestLength === -1 || bestAllow ? 'allowed' : 'disallowed';
}

/** One documented public API endpoint excepted from the `*` group of its host's robots.txt. */
export type RobotsExceptedEndpoint = {
  /** The lower-case host, matched exactly: no subdomain, no port. */
  readonly host: string;
  /** A path ending in `/` matches every path under it; any other path matches only itself. */
  readonly path: string;
};

/**
 * The documented public APIs fetched even where the host's `*` group disallows the path (D-871).
 * A robots.txt group that names our product token still applies to them in full.
 */
export const ROBOTS_EXCEPTED_ENDPOINTS: readonly RobotsExceptedEndpoint[] = [
  { host: 'en.wikipedia.org', path: '/w/api.php' },
  { host: 'commons.wikimedia.org', path: '/w/api.php' },
  { host: 'query.wikidata.org', path: '/sparql' },
  { host: 'api.github.com', path: '/repos/openstates/people/tarball/' },
  { host: 'codeload.github.com', path: '/openstates/people/legacy.tar.gz/' },
];

/** Whether `url` is one of ROBOTS_EXCEPTED_ENDPOINTS: https, the exact host, no port, the path. */
export function isRobotsExcepted(url: URL): boolean {
  if (url.protocol !== 'https:' || url.port !== '') {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  return ROBOTS_EXCEPTED_ENDPOINTS.some(
    (endpoint) =>
      endpoint.host === host &&
      (endpoint.path.endsWith('/') ? path.startsWith(endpoint.path) : path === endpoint.path),
  );
}

/** Whether a group of `rules` names `token` (case-insensitive), so that group applies, not `*`. */
export function namesToken(rules: RobotsRules, token: string): boolean {
  const wanted = token.toLowerCase();
  return rules.groups.some((group) => group.agents.some((agent) => agent.toLowerCase() === wanted));
}

/**
 * robotsDecision for a URL, with the endpoint exception (D-871): a path the `*` group disallows
 * is `excepted` when the URL is an excepted endpoint and no group names `token`.
 */
export function robotsDecisionForUrl(
  rules: RobotsRules,
  token: string,
  url: URL,
): 'allowed' | 'disallowed' | 'excepted' {
  const decision = robotsDecision(rules, token, `${url.pathname}${url.search}`);
  if (decision === 'disallowed' && isRobotsExcepted(url) && !namesToken(rules, token)) {
    return 'excepted';
  }
  return decision;
}

/** `cache/robots/<host>.json`: the last robots.txt answer; `status` is null for a network error. */
export const RobotsRecordSchema = z.strictObject({
  fetched_at: IsoInstantSchema,
  status: z.int().min(100).max(599).nullable(),
  body: z.string(),
});
export type RobotsRecord = z.infer<typeof RobotsRecordSchema>;

export type RobotsVerdict = {
  status: number | null;
  kind: 'rules' | 'absent' | 'unavailable' | 'challenge';
  rules: RobotsRules | null;
};

/** What a stored answer means: 2xx rules, 4xx absent, a challenge page, else unavailable. */
export function verdictOf(record: RobotsRecord): RobotsVerdict {
  const { status } = record;
  if (status === null) {
    return { status, kind: 'unavailable', rules: null };
  }
  // A challenge page is not an answer: the markers are checked before the 4xx rule.
  if (isChallenge(status, record.body)) {
    return { status, kind: 'challenge', rules: null };
  }
  if (status >= 200 && status < 300) {
    return { status, kind: 'rules', rules: parseRobots(record.body) };
  }
  if (status >= 400 && status < 500) {
    return { status, kind: 'absent', rules: null };
  }
  return { status, kind: 'unavailable', rules: null };
}

/**
 * robots.txt per host, read from the bucket and fetched again once 24 hours old. `fetchRobots`
 * makes the request through the fetcher's own request path.
 */
export class RobotsCache {
  readonly #bucket: DataBucket;
  readonly #clock: Clock;
  readonly #fetchRobots: (host: string) => Promise<RobotsRecord>;
  readonly #records = new Map<string, RobotsRecord>();
  readonly #pending = new Map<string, Promise<RobotsRecord>>();

  constructor(opts: {
    bucket: DataBucket;
    clock: Clock;
    fetchRobots: (host: string) => Promise<RobotsRecord>;
  }) {
    this.#bucket = opts.bucket;
    this.#clock = opts.clock;
    this.#fetchRobots = opts.fetchRobots;
  }

  async verdict(host: string): Promise<RobotsVerdict> {
    return verdictOf(await this.#record(host));
  }

  #fresh(record: RobotsRecord): boolean {
    return this.#clock.now() - Date.parse(record.fetched_at) < ROBOTS_MAX_AGE_MS;
  }

  async #record(host: string): Promise<RobotsRecord> {
    const known = this.#records.get(host);
    if (known !== undefined && this.#fresh(known)) {
      return known;
    }
    const pending = this.#pending.get(host);
    if (pending !== undefined) {
      return pending;
    }
    const load = this.#load(host, known === undefined);
    this.#pending.set(host, load);
    try {
      return await load;
    } finally {
      this.#pending.delete(host);
    }
  }

  async #load(host: string, readStored: boolean): Promise<RobotsRecord> {
    const key = bucketKeys.robots(host);
    if (readStored) {
      const stored = await this.#bucket.readIndexFile(key, RobotsRecordSchema);
      if (stored !== null && this.#fresh(stored)) {
        this.#records.set(host, stored);
        return stored;
      }
    }
    const record = await this.#fetchRobots(host);
    await this.#bucket.putJson(key, record, RobotsRecordSchema);
    this.#records.set(host, record);
    return record;
  }
}
