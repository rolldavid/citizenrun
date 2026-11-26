import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BRAND } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { createMemoryBucket } from '../../testing/memory-bucket.ts';
import { repoRoot } from '../paths.ts';
import { createFetcher } from './fetcher.ts';
import { EMPTY_RULES, FakeTransport, TestClock, quietLogger, robotsAnswer } from './test-fakes.ts';
import {
  CRAWL_POLICY_PATH,
  FetcherRefusedError,
  assertFetcherMayStart,
  fetcherRefusal,
  productToken,
  userAgent,
} from './user-agent.ts';

describe('user agent', () => {
  it("the user agent names the product token, version and the policy's public address", () => {
    const repo = BRAND.github.repository;
    expect(productToken()).toBe(`${BRAND.displayName}Bot`);
    expect(userAgent('1.2.3')).toBe(
      `${BRAND.displayName}Bot/1.2.3 (+https://github.com/${repo}/blob/main/docs/crawl-policy.md)`,
    );
  });

  it('the fetcher refuses to start when docs/crawl-policy.md is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fetch-'));
    try {
      expect(() => {
        assertFetcherMayStart(dir);
      }).toThrow(FetcherRefusedError);
      const clock = new TestClock();
      let thrown: unknown = null;
      try {
        createFetcher({
          transport: new FakeTransport(clock, (_req, url) => robotsAnswer(url)),
          clock,
          bucket: createMemoryBucket(),
          log: quietLogger(),
          isCi: false,
          userAgent: userAgent('0.0.0'),
          repoRoot: dir,
          hostRules: EMPTY_RULES,
          zoneForState: () => null,
          electionDatesForState: () => [],
          stateDir: dir,
        });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(FetcherRefusedError);
      expect((thrown as FetcherRefusedError).reason).toBe('crawl_policy_missing');
      expect((thrown as FetcherRefusedError).message).toBe('crawl_policy_missing');
      expect(() => {
        assertFetcherMayStart(repoRoot());
      }).not.toThrow();
      expect(fetcherRefusal(repoRoot(), null)).toBe('repository_unset');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('the crawl policy names the product token the fetcher sends', () => {
    const policy = readFileSync(join(repoRoot(), CRAWL_POLICY_PATH), 'utf8');
    const repo = BRAND.github.repository;
    expect(policy).toContain(productToken());
    expect(policy).toContain(userAgent('<version>'));
    expect(policy).toContain(`https://github.com/${repo}/issues`);
    expect(policy).not.toContain('plans/');
    expect(policy).not.toMatch(/D-\d{3}/u);
    expect(policy).not.toMatch(/R-\d{3}/u);
    expect(policy).not.toContain('milestone');
    const name = BRAND.displayName;
    const wrong = [
      `${name.slice(0, 1)}${name.slice(1).toLowerCase()}`,
      name.toUpperCase(),
      name.replace(/(?<=[a-z])(?=[A-Z])/gu, ' '),
    ];
    expect(new Set(wrong).size).toBe(3);
    for (const spelling of wrong) {
      expect(spelling).not.toBe(name);
      expect(policy).not.toContain(spelling);
    }
  });
});
