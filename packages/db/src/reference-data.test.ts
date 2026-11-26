import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ISSUE_IDS } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

// The authored reference lists agree with each other: every issue has a power, every power an
// issue, every relevance default names a real office type and power (D-319).

function dataFile(name: string): string {
  return fileURLToPath(new URL(`../../../data/${name}`, import.meta.url));
}

const FILES = ['powers.yaml', 'office-types.yaml', 'relevance-defaults.yaml'] as const;

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const PowersSchema = z.array(
  z.strictObject({
    id: z.string().regex(ID),
    name: z.string().min(1),
    description: z.string().min(1),
    issues: z.array(z.string()),
  }),
);

const OfficeTypesSchema = z.array(
  z.strictObject({
    id: z.string().regex(ID),
    name: z.string().min(1),
    level: z.string(),
    illustration: z.string(),
    electorate: z.string(),
    aliases: z.array(z.string()),
  }),
);

const RelevanceSchema = z.record(z.string(), z.record(z.string(), z.unknown()));

const IssuesSchema = z.array(z.looseObject({ id: z.string() }));

function read(name: string): unknown {
  return parse(readFileSync(dataFile(name), 'utf8'));
}

const powers = PowersSchema.parse(read('powers.yaml'));
const officeTypes = OfficeTypesSchema.parse(read('office-types.yaml'));
const relevance = RelevanceSchema.parse(read('relevance-defaults.yaml'));
const issueIds = IssuesSchema.parse(read('issues.yaml')).map((row) => row.id);

const SHARED_ILLUSTRATIONS: Readonly<Record<string, readonly string[]>> = {
  congress: ['us-house', 'us-senate'],
  legislature: ['state-house', 'state-senate'],
  'party-committee': ['party-committee', 'party-precinct-committee'],
};

const SPECIAL_TYPES = [
  'water-district-board',
  'soil-water-conservation-board',
  'hospital-district-board',
  'transit-board',
  'public-power-board',
  'fire-district-board',
  'special-district-other',
  'coop-board',
  'pension-board',
  'party-precinct-committee',
  'party-committee',
];

const TYPES_WITHOUT_DEFAULT = [
  'statewide-executive-other',
  'state-appellate-judge',
  'county-executive',
  'county-row-other',
  'township-board',
  'community-college-board',
  'fire-district-board',
  'special-district-other',
];

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

describe('the reference data files', () => {
  it('the lists have their sizes', () => {
    expect(powers).toHaveLength(41);
    expect(powers.reduce((total, power) => total + power.issues.length, 0)).toBe(78);
    expect(officeTypes).toHaveLength(42);
    expect(new Set(officeTypes.map((type) => type.illustration)).size).toBe(39);
    expect(Object.keys(relevance)).toHaveLength(34);
    expect(
      Object.values(relevance).reduce((total, inner) => total + Object.keys(inner).length, 0),
    ).toBe(71);
  });

  it('every issue has a power and every power an issue', () => {
    const named = new Set(powers.flatMap((power) => power.issues));
    expect(issueIds).toHaveLength(19);
    expect(sorted(named)).toEqual(sorted(issueIds));
    expect(sorted(named)).toEqual(sorted(ISSUE_IDS));
    for (const power of powers) {
      expect(power.issues.length, power.id).toBeGreaterThan(0);
      expect(new Set(power.issues).size, power.id).toBe(power.issues.length);
    }
    expect(new Set(powers.map((power) => power.id)).size).toBe(powers.length);
  });

  it('illustrations are the 39 drawn ids', () => {
    const byIllustration = new Map<string, string[]>();
    for (const type of officeTypes) {
      expect(type.illustration, type.id).toMatch(ID);
      byIllustration.set(type.illustration, [
        ...(byIllustration.get(type.illustration) ?? []),
        type.id,
      ]);
    }
    const shared = Object.fromEntries(
      [...byIllustration]
        .filter(([, ids]) => ids.length > 1)
        .map(([illustration, ids]) => [illustration, sorted(ids)]),
    );
    expect(shared).toEqual(SHARED_ILLUSTRATIONS);
    const sharing = new Set(Object.values(SHARED_ILLUSTRATIONS).flat());
    for (const type of officeTypes.filter((row) => !sharing.has(row.id))) {
      expect(type.illustration).toBe(type.id);
    }
  });

  it('the electorate follows the office type', () => {
    const idsWith = (electorate: string): string[] =>
      sorted(officeTypes.filter((type) => type.electorate === electorate).map((type) => type.id));
    expect(idsWith('members')).toEqual(['coop-board', 'pension-board']);
    expect(idsWith('party')).toEqual(['party-committee', 'party-precinct-committee']);
    expect(idsWith('public')).toHaveLength(38);
    expect(idsWith('members').length + idsWith('party').length + idsWith('public').length).toBe(
      officeTypes.length,
    );
  });

  it('levels are the five district levels', () => {
    for (const type of officeTypes) {
      expect(['local', 'county', 'state', 'federal', 'special'], type.id).toContain(type.level);
    }
    expect(
      sorted(officeTypes.filter((type) => type.level === 'special').map((type) => type.id)),
    ).toEqual(sorted(SPECIAL_TYPES));
  });

  it('relevance keys are office types and powers', () => {
    const typeIds = new Set(officeTypes.map((type) => type.id));
    const powerIds = new Set(powers.map((power) => power.id));
    for (const [typeId, inner] of Object.entries(relevance)) {
      expect(typeIds.has(typeId), typeId).toBe(true);
      for (const [powerId, value] of Object.entries(inner)) {
        expect(powerIds.has(powerId), `${typeId} ${powerId}`).toBe(true);
        expect([1, 2, 3], `${typeId} ${powerId}`).toContain(value);
      }
    }
  });

  it('the eight types without a default are the listed ones', () => {
    const withDefault = new Set(Object.keys(relevance));
    expect(sorted(officeTypes.map((type) => type.id).filter((id) => !withDefault.has(id)))).toEqual(
      sorted(TYPES_WITHOUT_DEFAULT),
    );
  });

  it('aliases are lower case and unique per type', () => {
    for (const type of officeTypes) {
      for (const alias of type.aliases) {
        expect(alias.length, type.id).toBeGreaterThan(0);
        expect(alias, type.id).toBe(alias.toLowerCase());
      }
      expect(new Set(type.aliases).size, type.id).toBe(type.aliases.length);
    }
  });

  it('the files cite no plan document', () => {
    const citations = [
      /\b[TP]:\d+/,
      /\bR0\d\b/,
      /\bR-\d{3}\b/,
      /\bD-\d{3}\b/,
      /Plan choice/,
      /plans\//,
    ];
    for (const name of FILES) {
      const text = readFileSync(dataFile(name), 'utf8');
      for (const citation of citations) {
        expect(text, `${name} ${String(citation)}`).not.toMatch(citation);
      }
    }
  });
});
