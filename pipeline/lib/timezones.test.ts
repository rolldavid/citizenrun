import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { FieldMetaRowSchema } from '@citizenrun/shared';
import { load } from 'cheerio';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTimezones } from './data-files.ts';
import { repoRoot } from './paths.ts';
import {
  loadTimezoneRegister,
  zoneForCoop,
  zoneForCounty,
  zoneForState,
  zoneForUnit,
  zoneProof,
} from './timezones.ts';
import type { TimezoneRegister } from './timezones.ts';

const FIXTURES = join(repoRoot(), 'pipeline', '__fixtures__', 'timezones');

let reg: TimezoneRegister;

beforeAll(async () => {
  reg = await loadTimezoneRegister();
});

function plainText(html: string): string {
  return load(html).root().text().normalize('NFC').replace(/\s+/g, ' ');
}

describe('zones from the register', () => {
  it('a state takes its default', () => {
    expect(zoneForState(reg, 'NC')).toBe('America/New_York');
    expect(zoneForState(reg, 'VA')).toBe('America/New_York');
    expect(zoneForState(reg, 'LA')).toBe('America/Chicago');
    expect(zoneForState(reg, 'TX')).toBe('America/Chicago');
    expect(zoneForState(reg, 'WA')).toBe('America/Los_Angeles');
  });

  it('a county takes its override or the default', () => {
    const elPaso = reg.get('TX')?.county_overrides.find((row) => row.county_geoid === '48141');
    expect(elPaso?.zone).toBe('America/Denver');
    expect(zoneForCounty(reg, 'TX', '48141')).toBe(elPaso?.zone);
    expect(zoneForCounty(reg, 'TX', '48229')).toBe('America/Denver');
    expect(zoneForCounty(reg, 'TX', '48201')).toBe('America/Chicago');
  });

  it("a unit takes its county's zone", () => {
    expect(zoneForUnit(reg, 'TX', '48', '141')).toBe('America/Denver');
    expect(zoneForUnit(reg, 'TX', '48', '201')).toBe('America/Chicago');
  });

  it("a co-op takes its most populous county's zone", () => {
    expect(
      zoneForCoop(reg, 'TX', [
        { geoid: '48201', population: 10 },
        { geoid: '48141', population: 20 },
      ]),
    ).toBe('America/Denver');
    // A tie goes to the smaller GEOID.
    expect(
      zoneForCoop(reg, 'TX', [
        { geoid: '48229', population: 5 },
        { geoid: '48201', population: 5 },
      ]),
    ).toBe('America/Chicago');
    // A null population counts as 0.
    expect(
      zoneForCoop(reg, 'TX', [
        { geoid: '48141', population: null },
        { geoid: '48201', population: 1 },
      ]),
    ).toBe('America/Chicago');
    expect(zoneForCoop(reg, 'TX', [])).toBeNull();
  });

  it('a state with no entry is null', () => {
    expect(zoneForState(reg, 'ZZ')).toBeNull();
    expect(zoneForCounty(reg, 'ZZ', '99001')).toBeNull();
    expect(zoneForUnit(reg, 'ZZ', '99', '001')).toBeNull();
    expect(zoneForCoop(reg, 'ZZ', [{ geoid: '99001', population: 1 }])).toBeNull();
    expect(zoneProof(reg, 'ZZ', '2026-11-26T00:00:00.000Z')).toBeNull();
  });

  it('the proof is medium with the citation', () => {
    const proof = zoneProof(reg, 'TX', '2026-11-26T00:00:00.000Z');
    const entry = reg.get('TX');
    expect(proof).toEqual({
      source_url: entry?.source_url,
      quote: entry?.quote,
      confidence: 'medium',
      checked_at: '2026-11-26T00:00:00.000Z',
      rule_citation: '49 CFR 71.7',
    });
    expect(FieldMetaRowSchema.safeParse(proof).success).toBe(true);
  });
});

describe('the saved pages', () => {
  it('each quote is in its saved page', async () => {
    const files = (await readdir(FIXTURES)).filter((name) => name.endsWith('.html'));
    const pages = new Map<string, string>();
    for (const file of files) {
      const meta = JSON.parse(await readFile(join(FIXTURES, `${file}.meta.json`), 'utf8')) as {
        url: string;
      };
      pages.set(meta.url, plainText(await readFile(join(FIXTURES, file), 'utf8')));
    }
    const entries = await loadTimezones();
    expect(entries.length).toBe(5);
    for (const entry of entries) {
      const page = pages.get(entry.source_url);
      expect(page, `${entry.state}: no saved page for its source_url`).toBeDefined();
      const quote = entry.quote.normalize('NFC').replace(/\s+/g, ' ');
      expect(page?.includes(quote), `${entry.state}: quote not in its saved page`).toBe(true);
    }
  });
});
