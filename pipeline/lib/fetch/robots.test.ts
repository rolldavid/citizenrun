import { describe, expect, it } from 'vitest';
import { createMemoryBucket } from '../../testing/memory-bucket.ts';
import { bucketKeys } from '../bucket.ts';
import {
  RobotsCache,
  RobotsRecordSchema,
  parseRobots,
  robotsDecision,
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
