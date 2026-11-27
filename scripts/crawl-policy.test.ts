import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BRAND } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './lib/repo-root.ts';

// The crawler's public policy (D-331, D-799): the page its user agent links to.
const POLICY = readFileSync(join(repoRoot(), 'docs/crawl-policy.md'), 'utf8');

// The forms of the name D-016 forbids, built from the brand: the first letter alone in capitals,
// every letter in capitals, and two words.
function wrongSpellings(name: string): string[] {
  return [
    name.charAt(0) + name.slice(1).toLowerCase(),
    name.toUpperCase(),
    name.replace(/([a-z])([A-Z])/g, '$1 $2'),
  ].filter((spelling) => spelling !== name);
}

describe('docs/crawl-policy.md', () => {
  it('the crawl policy names the crawler', () => {
    const repository = BRAND.github.repository;
    expect(repository).not.toBeNull();
    expect(POLICY).toContain(`${BRAND.displayName}Bot`);
    expect(POLICY).toContain(`User-agent: ${BRAND.displayName}Bot`);
    expect(POLICY).toContain(`https://github.com/${repository}/issues`);
    expect(POLICY).toContain(
      `${BRAND.displayName}Bot/<version> (+https://github.com/${repository}/blob/main/docs/crawl-policy.md)`,
    );
  });

  it('the crawl policy holds no plan wording', () => {
    expect(POLICY).not.toContain('plans/');
    expect(POLICY).not.toContain('contracts/');
    expect(POLICY).not.toMatch(/D-\d{3}/);
    expect(POLICY).not.toMatch(/R-\d{3}/);
    expect(POLICY).not.toMatch(/M\d{2}-S\d/);
    expect(POLICY.toLowerCase()).not.toContain('milestone');
    const spellings = wrongSpellings(BRAND.displayName);
    expect(spellings).toHaveLength(3);
    for (const spelling of spellings) {
      expect(POLICY, spelling).not.toContain(spelling);
    }
  });

  it('the crawl policy states the pace the crawler keeps', () => {
    for (const rule of [
      'RFC 9309',
      '24 hours',
      'one request every two seconds',
      '2,000 requests',
      'Retry-After',
      '429',
      '503',
      'No requests to election results servers on election nights.',
      '400 days',
    ]) {
      expect(POLICY, rule).toContain(rule);
    }
  });

  it('the crawl policy sets no business-hours limit', () => {
    expect(POLICY).not.toContain('08:00 to 18:00');
    expect(POLICY).not.toContain('Website pages are read outside');
    expect(POLICY.toLowerCase()).not.toContain('business-hours');
    expect(POLICY.toLowerCase()).not.toContain('business hours');
  });
});
