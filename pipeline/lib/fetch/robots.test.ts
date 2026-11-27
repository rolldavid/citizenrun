import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMemoryBucket } from '../../testing/memory-bucket.ts';
import { bucketKeys } from '../bucket.ts';
import { repoRoot } from '../paths.ts';
import {
  ROBOTS_EXCEPTED_ENDPOINTS,
  RobotsCache,
  RobotsRecordSchema,
  isRobotsExcepted,
  namesToken,
  parseRobots,
  robotsDecision,
  robotsDecisionForUrl,
  verdictOf,
} from './robots.ts';
import type { RobotsRecord } from './robots.ts';
import { TestClock } from './test-fakes.ts';
import { productToken } from './user-agent.ts';

const TOKEN = productToken();
const decide = (text: string, path: string) => robotsDecision(parseRobots(text), TOKEN, path);

describe('obeys robots.txt', () => {
  it('longest match wins', () => {
    const text = 'User-agent: *\nDisallow: /a\nAllow: /a/b\n';
    expect(decide(text, '/a/b/c')).toBe('allowed');
    expect(decide(text, '/a/c')).toBe('disallowed');
  });

  it('allow wins a tie', () => {
    expect(decide('User-agent: *\nAllow: /p\nDisallow: /p\n', '/p')).toBe('allowed');
    expect(decide('User-agent: *\nDisallow: /p\nAllow: /p\n', '/p/q')).toBe('allowed');
  });

  it('wildcards and end anchor', () => {
    const text = 'User-agent: *\nDisallow: /*.csv$\n';
    expect(decide(text, '/x/list.csv')).toBe('disallowed');
    expect(decide(text, '/x/list.csv?y=1')).toBe('allowed');
    expect(decide('User-agent: *\nDisallow: /a*b\n', '/a/x/b/c')).toBe('disallowed');
    expect(decide('User-agent: *\nDisallow: /a*b\n', '/a/x/c')).toBe('allowed');
  });

  it('our group beats the star group', () => {
    const text = `User-agent: ${TOKEN}\nAllow: /\n\nUser-agent: *\nDisallow: /\n`;
    expect(decide(text, '/anything')).toBe('allowed');
    expect(robotsDecision(parseRobots(text), 'OtherBot', '/anything')).toBe('disallowed');
  });

  it('agent match is case-insensitive', () => {
    const text = `User-agent: ${TOKEN.toUpperCase()}\nDisallow: /\n\nUser-agent: *\nAllow: /\n`;
    expect(decide(text, '/x')).toBe('disallowed');
    expect(decide(`USER-AGENT: ${TOKEN.toLowerCase()}\nDISALLOW: /x\n`, '/x')).toBe('disallowed');
  });

  it('empty disallow allows', () => {
    expect(decide('User-agent: *\nDisallow:\n', '/anything')).toBe('allowed');
  });

  it('robots.txt itself is always allowed', () => {
    expect(decide('User-agent: *\nDisallow: /\n', '/robots.txt')).toBe('allowed');
    expect(decide('User-agent: *\nDisallow: /\n', '/other')).toBe('disallowed');
  });

  it('percent escapes compare equal', () => {
    expect(decide('User-agent: *\nDisallow: /a%3c\n', '/a%3C')).toBe('disallowed');
    expect(decide('User-agent: *\nDisallow: /a%3C\n', '/a%3cd')).toBe('disallowed');
    // An escape of an unreserved character is decoded.
    expect(decide('User-agent: *\nDisallow: /%7Euser\n', '/~user/x')).toBe('disallowed');
  });

  it('groups, comments and ignored keys', () => {
    const text = [
      'Allow: /before-any-agent',
      'Disallow: /orphan # no group yet',
      `User-agent: a`,
      `User-agent: ${TOKEN}`,
      'Crawl-delay: 30',
      'Sitemap: /sitemap.xml',
      'Disallow: /shared',
      'User-agent: b',
      'Disallow: /b-only',
    ].join('\r\n');
    const rules = parseRobots(text);
    expect(rules.groups).toEqual([
      { agents: ['a', TOKEN], rules: [{ allow: false, pattern: '/shared' }] },
      { agents: ['b'], rules: [{ allow: false, pattern: '/b-only' }] },
    ]);
    expect(decide(text, '/orphan')).toBe('allowed');
    expect(decide(text, '/shared/x')).toBe('disallowed');
    expect(decide(text, '/b-only')).toBe('allowed');
  });

  it('a crawl-delay line ends the run of user-agent lines', () => {
    const text = [
      'User-agent: *',
      'Crawl-delay: 10',
      '',
      'User-agent: SomeBot',
      'Disallow: /',
    ].join('\n');
    expect(parseRobots(text).groups).toEqual([
      { agents: ['*'], rules: [] },
      { agents: ['SomeBot'], rules: [{ allow: false, pattern: '/' }] },
    ]);
    expect(decide(text, '/laws/section')).toBe('allowed');
    expect(robotsDecision(parseRobots(text), 'SomeBot', '/laws/section')).toBe('disallowed');
  });

  it('no matching group allows everything', () => {
    expect(decide('User-agent: OtherBot\nDisallow: /\n', '/x')).toBe('allowed');
  });

  it('reads at most the first 512,000 bytes', () => {
    const filler = `# ${'x'.repeat(520_000)}\n`;
    const rules = parseRobots(`User-agent: *\nDisallow: /early\n${filler}Disallow: /late\n`);
    expect(rules.groups[0]?.rules).toEqual([{ allow: false, pattern: '/early' }]);
  });

  it('a stored answer reads as rules, absent, unavailable or challenge', () => {
    const at = '2026-11-26T00:00:00.000Z';
    expect(verdictOf({ fetched_at: at, status: 200, body: 'User-agent: *' }).kind).toBe('rules');
    expect(verdictOf({ fetched_at: at, status: 404, body: '' }).kind).toBe('absent');
    expect(verdictOf({ fetched_at: at, status: 503, body: '' }).kind).toBe('unavailable');
    expect(verdictOf({ fetched_at: at, status: null, body: '' }).kind).toBe('unavailable');
    expect(
      verdictOf({ fetched_at: at, status: 403, body: '<title>Just a moment...</title>' }).kind,
    ).toBe('challenge');
  });

  it('the cache keeps a record for less than 24 hours and stores it in the bucket', async () => {
    const clock = new TestClock('2026-11-26T12:00:00.000Z');
    const bucket = createMemoryBucket();
    let calls = 0;
    const cache = new RobotsCache({
      bucket,
      clock,
      fetchRobots: (): Promise<RobotsRecord> => {
        calls += 1;
        return Promise.resolve({
          fetched_at: new Date(clock.now()).toISOString(),
          status: 200,
          body: 'User-agent: *\nDisallow: /x\n',
        });
      },
    });
    expect((await cache.verdict('a.example.test')).kind).toBe('rules');
    expect(calls).toBe(1);
    expect(
      await bucket.getJson(bucketKeys.robots('a.example.test'), RobotsRecordSchema),
    ).not.toBeNull();
    clock.t += 23 * 60 * 60 * 1000;
    await cache.verdict('a.example.test');
    expect(calls).toBe(1);
    clock.t += 60 * 60 * 1000;
    await cache.verdict('a.example.test');
    expect(calls).toBe(2);
    // A second cache on the same bucket reads the stored record and makes no request.
    let otherCalls = 0;
    const other = new RobotsCache({
      bucket,
      clock,
      fetchRobots: () => {
        otherCalls += 1;
        return Promise.reject(new Error('not expected'));
      },
    });
    expect((await other.verdict('a.example.test')).kind).toBe('rules');
    expect(otherCalls).toBe(0);
  });
});

describe('the documented public API exception', () => {
  const excepted = (href: string) => isRobotsExcepted(new URL(href));
  const STAR_DISALLOWS = 'User-agent: *\nDisallow: /w/\nDisallow: /sparql\nDisallow: /repos/\n';
  const decideUrl = (text: string, href: string) =>
    robotsDecisionForUrl(parseRobots(text), TOKEN, new URL(href));

  it('lists exactly the six endpoints', () => {
    expect(ROBOTS_EXCEPTED_ENDPOINTS).toEqual([
      { host: 'en.wikipedia.org', path: '/w/api.php' },
      { host: 'commons.wikimedia.org', path: '/w/api.php' },
      { host: 'query.wikidata.org', path: '/sparql' },
      { host: 'api.github.com', path: '/repos/openstates/people/tarball/' },
      { host: 'codeload.github.com', path: '/openstates/people/legacy.tar.gz/' },
      { host: 'app.leg.wa.gov', path: '/RCW/' },
    ]);
  });

  it('matches the listed hosts and paths, with any query', () => {
    expect(excepted('https://en.wikipedia.org/w/api.php?action=query&titles=A')).toBe(true);
    expect(excepted('https://EN.Wikipedia.org/w/api.php')).toBe(true);
    expect(excepted('https://commons.wikimedia.org/w/api.php?action=query')).toBe(true);
    expect(excepted('https://query.wikidata.org/sparql?format=json&query=x')).toBe(true);
    expect(excepted('https://api.github.com/repos/openstates/people/tarball/main')).toBe(true);
    expect(
      excepted('https://codeload.github.com/openstates/people/legacy.tar.gz/refs/heads/main'),
    ).toBe(true);
  });

  it('does not match other paths on the listed hosts', () => {
    expect(excepted('https://en.wikipedia.org/w/index.php?title=A')).toBe(false);
    expect(excepted('https://en.wikipedia.org/wiki/A')).toBe(false);
    expect(excepted('https://en.wikipedia.org/w/api.php5')).toBe(false);
    expect(excepted('https://en.wikipedia.org/w/api.php/extra')).toBe(false);
    expect(excepted('https://en.wikipedia.org/W/api.php')).toBe(false);
    expect(excepted('https://en.wikipedia.org/w/api%2Ephp')).toBe(false);
    expect(excepted('https://commons.wikimedia.org/wiki/File:A.jpg')).toBe(false);
    expect(excepted('https://query.wikidata.org/sparqlx')).toBe(false);
    expect(excepted('https://query.wikidata.org/bigdata/namespace/wdq/sparql')).toBe(false);
    expect(excepted('https://api.github.com/repos/openstates/people/tarball')).toBe(false);
    expect(excepted('https://api.github.com/repos/openstates/people/zipball/main')).toBe(false);
    expect(excepted('https://api.github.com/repos/openstates/other/tarball/main')).toBe(false);
    expect(excepted('https://api.github.com/repos/someone/people/tarball/main')).toBe(false);
    expect(excepted('https://codeload.github.com/openstates/other/legacy.tar.gz/main')).toBe(false);
    expect(excepted('https://codeload.github.com/openstates/people/tar.gz/main')).toBe(false);
  });

  it('does not match other hosts, lookalikes, ports or http', () => {
    expect(excepted('https://en.wikipedia.org.evil.test/w/api.php')).toBe(false);
    expect(excepted('https://xen.wikipedia.org/w/api.php')).toBe(false);
    expect(excepted('https://de.wikipedia.org/w/api.php')).toBe(false);
    expect(excepted('https://en.m.wikipedia.org/w/api.php')).toBe(false);
    expect(excepted('https://wikipedia.org/w/api.php')).toBe(false);
    expect(excepted('https://query.wikidata.org.example.test/sparql')).toBe(false);
    expect(excepted('https://www.wikidata.org/sparql')).toBe(false);
    expect(excepted('https://github.com/repos/openstates/people/tarball/main')).toBe(false);
    expect(excepted('https://en.wikipedia.org:8443/w/api.php')).toBe(false);
    expect(excepted('http://en.wikipedia.org/w/api.php')).toBe(false);
  });

  it('a star-group disallow is passed only for a listed endpoint', () => {
    expect(decideUrl(STAR_DISALLOWS, 'https://en.wikipedia.org/w/api.php?action=query')).toBe(
      'excepted',
    );
    expect(decideUrl(STAR_DISALLOWS, 'https://query.wikidata.org/sparql?query=x')).toBe('excepted');
    expect(decideUrl(STAR_DISALLOWS, 'https://en.wikipedia.org/w/index.php?title=A')).toBe(
      'disallowed',
    );
    expect(decideUrl(STAR_DISALLOWS, 'https://en.wikipedia.org.evil.test/w/api.php')).toBe(
      'disallowed',
    );
    expect(decideUrl(STAR_DISALLOWS, 'https://xen.wikipedia.org/w/api.php')).toBe('disallowed');
  });

  it('an allowed endpoint stays allowed, not excepted', () => {
    expect(
      decideUrl('User-agent: *\nDisallow: /wiki/\n', 'https://en.wikipedia.org/w/api.php'),
    ).toBe('allowed');
  });

  it('a group naming our token still refuses a listed endpoint', () => {
    const ours = `User-agent: ${TOKEN}\nDisallow: /\n\nUser-agent: *\nAllow: /\n`;
    expect(decideUrl(ours, 'https://en.wikipedia.org/w/api.php?action=query')).toBe('disallowed');
    const oursPath = `User-agent: ${TOKEN.toLowerCase()}\nDisallow: /sparql\n`;
    expect(decideUrl(oursPath, 'https://query.wikidata.org/sparql?query=x')).toBe('disallowed');
    expect(namesToken(parseRobots(ours), TOKEN)).toBe(true);
    expect(namesToken(parseRobots(STAR_DISALLOWS), TOKEN)).toBe(false);
  });

  it('matches every page under the Washington code, the PDF copies included', () => {
    expect(excepted('https://app.leg.wa.gov/RCW/default.aspx?cite=29A.24.050')).toBe(true);
    expect(excepted('https://app.leg.wa.gov/RCW/default.aspx?cite=29A.24.050&pdf=true')).toBe(true);
    expect(excepted('https://app.leg.wa.gov/RCW/default.aspx?cite=29A.24')).toBe(true);
    expect(excepted('https://APP.LEG.WA.GOV/RCW/default.aspx?cite=29A.24.050')).toBe(true);
    expect(excepted('https://app.leg.wa.gov/RCW/')).toBe(true);
  });

  it('does not match other paths or hosts beside the Washington code', () => {
    expect(excepted('https://app.leg.wa.gov/')).toBe(false);
    expect(excepted('https://app.leg.wa.gov/other/')).toBe(false);
    expect(excepted('https://app.leg.wa.gov/RCW')).toBe(false);
    expect(excepted('https://app.leg.wa.gov/rcw/default.aspx?cite=29A.24.050')).toBe(false);
    expect(excepted('https://app.leg.wa.gov/RCWx/default.aspx')).toBe(false);
    expect(excepted('https://app.leg.wa.gov/WAC/default.aspx?cite=434-215')).toBe(false);
    expect(excepted('https://app.leg.wa.gov/billsummary?BillNumber=1')).toBe(false);
    expect(excepted('https://leg.wa.gov/RCW/default.aspx?cite=29A.24.050')).toBe(false);
    expect(excepted('https://lawfilesext.leg.wa.gov/RCW/default.aspx')).toBe(false);
    expect(excepted('https://app.leg.wa.gov.example.test/RCW/default.aspx')).toBe(false);
    expect(excepted('https://app.leg.wa.gov:8443/RCW/default.aspx')).toBe(false);
    expect(excepted('http://app.leg.wa.gov/RCW/default.aspx?cite=29A.24.050')).toBe(false);
  });

  it('a star-group disallow of the whole host is passed only for the Washington code', () => {
    const all = 'User-agent: *\nDisallow: /\n';
    expect(decideUrl(all, 'https://app.leg.wa.gov/RCW/default.aspx?cite=29A.24.050')).toBe(
      'excepted',
    );
    expect(decideUrl(all, 'https://app.leg.wa.gov/RCW/default.aspx?cite=29A.24.050&pdf=true')).toBe(
      'excepted',
    );
    expect(decideUrl(all, 'https://app.leg.wa.gov/')).toBe('disallowed');
    expect(decideUrl(all, 'https://app.leg.wa.gov/other/')).toBe('disallowed');
  });

  it('a group naming our token still refuses the Washington code', () => {
    const ours = `User-agent: ${TOKEN}\nDisallow: /\n\nUser-agent: *\nDisallow: /\n`;
    expect(decideUrl(ours, 'https://app.leg.wa.gov/RCW/default.aspx?cite=29A.24.050')).toBe(
      'disallowed',
    );
    const oursPath = `User-agent: ${TOKEN}\nDisallow: /RCW/\n`;
    expect(decideUrl(oursPath, 'https://app.leg.wa.gov/RCW/default.aspx?cite=29A.24.050')).toBe(
      'disallowed',
    );
  });

  it('a group naming our token that allows the path allows it', () => {
    const ours = `User-agent: ${TOKEN}\nDisallow: /wiki/\n\nUser-agent: *\nDisallow: /\n`;
    expect(decideUrl(ours, 'https://en.wikipedia.org/w/api.php')).toBe('allowed');
  });

  it('the crawl policy lists every excepted endpoint', () => {
    const policy = readFileSync(join(repoRoot(), 'docs/crawl-policy.md'), 'utf8');
    for (const endpoint of ROBOTS_EXCEPTED_ENDPOINTS) {
      expect(policy).toContain(`\`https://${endpoint.host}${endpoint.path}\``);
    }
  });
});
