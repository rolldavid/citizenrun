// Builders for the known-bodies tests: stage 1 districts from the saved TIGER tables, the ZZ
// fixture state and template, and a complete KnownInput with no slug registry.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BDistrictSchema } from '@citizenrun/shared';
import type { BDistrict } from '@citizenrun/shared';
import { loadParties } from '../lib/data-files.ts';
import { assignSlugs } from '../lib/slug.ts';
import type { OpenStatesPerson } from '../sources/openstates.ts';
import { readDbfFile } from '../sources/tiger.ts';
import { ZZ_RULES } from '../templates/__fixtures__/zz-rules.ts';
import { citedNodes } from '../templates/cited.ts';
import type { GroundedMark } from '../templates/ground.ts';
import type { TemplateOutput } from '../templates/output.ts';
import { validateTemplateText } from '../templates/validate.ts';
import { readSavedSample } from '../testing/saved-sample.ts';
import type { KnownInput, SlugAssigner } from './s02-known.ts';
import { loadReferenceIds, loadRelevanceDefaults } from './shared/reference.ts';
import { repoRoot } from './shared/repo.ts';

export const KNOWN_FIXTURES = join(import.meta.dirname, '..', '__fixtures__', 's02', 'known');
const TEMPLATE_FIXTURES = join(import.meta.dirname, '..', 'templates', '__fixtures__');

export const FIXTURE_NOW = new Date('2026-11-16T15:00:00.000Z');
export const FIXTURE_TODAY = '2026-11-16';
const GEOM_HASH = '0'.repeat(64);

/** A saved sample's text, checked against its sidecar. */
export async function savedText(name: string): Promise<string> {
  const { bytes } = await readSavedSample(join(KNOWN_FIXTURES, name));
  return new TextDecoder('utf-8').decode(bytes);
}

/** A stage 1 state-wide district row of `state`. */
export function district(
  state: string,
  key: string,
  name: string,
  population: number | null = null,
): BDistrict {
  return BDistrictSchema.parse({
    source_key: key,
    jurisdiction_key: `state:${state}`,
    name,
    level: key.startsWith('tiger:cd:') ? 'federal' : 'state',
    geometry_quality: 'exact',
    geom_hash: GEOM_HASH,
    population,
    population_18: null,
    lean: null,
    lean_basis: null,
    field_meta: {},
  });
}

/** Colorado's SLDU and SLDL districts from the saved attribute tables, and its state district. */
export async function coloradoDistricts(): Promise<{
  sldu: readonly BDistrict[];
  sldl: readonly BDistrict[];
  all: readonly BDistrict[];
}> {
  const layer = async (name: 'sldu' | 'sldl') => {
    await readSavedSample(join(KNOWN_FIXTURES, `tl_2026_08_${name}.dbf`));
    const rows = await readDbfFile(join(KNOWN_FIXTURES, `tl_2026_08_${name}.dbf`), [
      'GEOID',
      'NAMELSAD',
    ]);
    return rows.map((row) =>
      district('CO', `tiger:${name}:${String(row['GEOID'])}`, String(row['NAMELSAD'])),
    );
  };
  const sldu = await layer('sldu');
  const sldl = await layer('sldl');
  return { sldu, sldl, all: [district('CO', 'tiger:state:08', 'Colorado'), ...sldu, ...sldl] };
}

const Cd120ExcerptSchema = {
  parse(value: unknown): readonly { GEOID: string; CD120FP: string; NAMELSAD: string }[] {
    if (!Array.isArray(value)) throw new TypeError('the excerpt is a list');
    return value.map((row: unknown) => {
      const r = row as Record<string, unknown>; // parsed JSON object, checked below
      if (
        typeof r['GEOID'] !== 'string' ||
        typeof r['CD120FP'] !== 'string' ||
        typeof r['NAMELSAD'] !== 'string'
      ) {
        throw new TypeError('an excerpt row has GEOID, CD120FP and NAMELSAD');
      }
      return { GEOID: r['GEOID'], CD120FP: r['CD120FP'], NAMELSAD: r['NAMELSAD'] };
    });
  },
};

/** A state's stage 1 congressional districts from its saved cd120 excerpt, and its state district. */
export async function congressDistricts(
  state: 'WY' | 'DC',
  fips: '56' | '11',
  stateName: string,
): Promise<readonly BDistrict[]> {
  const rows = Cd120ExcerptSchema.parse(
    JSON.parse(await savedText(`tl_2026_${fips}_cd120-excerpt.json`)),
  );
  return [
    district(state, `tiger:state:${fips}`, stateName),
    ...rows.map((row) => district(state, `tiger:cd:${row.GEOID}`, row.NAMELSAD)),
  ];
}

/** The ZZ stage 1 districts: four senate and two house districts, one ZZZ area, two cd features. */
export function zzDistricts(): readonly BDistrict[] {
  return [
    district('ZZ', 'tiger:state:99', 'Fixture State', 5000),
    ...[1, 2, 3, 4].map((n) =>
      district('ZZ', `tiger:sldu:9900${String(n)}`, `State Senate District ${String(n)}`, 1000 + n),
    ),
    district('ZZ', 'tiger:sldl:99001', 'State House District 1', 2001),
    district('ZZ', 'tiger:sldl:99002', 'State House District 2', 2002),
    district('ZZ', 'tiger:sldl:99ZZZ', 'State House Districts not defined', 0),
    district('ZZ', 'tiger:cd:9901', 'Congressional District 1', 2500),
    district('ZZ', 'tiger:cd:9902', 'Congressional District 2', 2500),
  ];
}

export function fixtureLegislator(
  id: string,
  chamber: OpenStatesPerson['currentChamber'],
  label: string,
  overrides: Partial<OpenStatesPerson> = {},
): OpenStatesPerson {
  return {
    id: `ocd-person/${id}`,
    name: `Fixture Legislator ${id}`,
    currentParty: 'Democratic',
    currentDistrict: label,
    currentChamber: chamber,
    givenName: 'Fixture',
    familyName: `Legislator ${id}`,
    links: [],
    sources: [],
    ...overrides,
  };
}

export const UNGROUNDED: GroundedMark = {
  grounded: false,
  checked_at: null,
  text_sha256: null,
  reason: 'refused',
};

export const GROUNDED: GroundedMark = {
  grounded: true,
  checked_at: '2026-11-10T23:30:00.000Z',
  text_sha256: 'a'.repeat(64),
  reason: 'grounded',
};

/** The ZZ fixture template as stage 3 writes it, every quote grounded. */
export async function zzTemplateOutput(): Promise<TemplateOutput> {
  const text = await readFile(join(TEMPLATE_FIXTURES, 'zz-template.yaml'), 'utf8');
  const reference = await loadReferenceIds(repoRoot());
  const result = validateTemplateText(text, {
    state: 'ZZ',
    officeTypeIds: reference.officeTypeIds,
    powerIds: reference.powerIds,
    rules: ZZ_RULES,
    isFixture: true,
  });
  if (!result.ok) {
    throw new Error('the ZZ fixture template does not validate');
  }
  const grounded: Record<string, GroundedMark> = {};
  for (const { path } of citedNodes(result.template)) {
    grounded[path] = GROUNDED;
  }
  return {
    schema_version: 1,
    state: 'ZZ',
    template: result.template,
    grounded,
    checked_at: '2026-11-10T23:30:00.000Z',
  };
}

/** PIPE-slugs over an empty registry. */
export const freshSlugs: SlugAssigner = (requests) => assignSlugs(new Map(), requests).assigned;

/** A KnownInput with no template, no rules, no people and ungrounded federal terms. */
export async function knownInput(overrides: Partial<KnownInput>): Promise<KnownInput> {
  return {
    state: 'ZZ',
    stateFips: '99',
    stateName: 'Fixture State',
    today: FIXTURE_TODAY,
    now: FIXTURE_NOW,
    districts: [],
    template: null,
    rules: null,
    openStates: [],
    legislators: [],
    federalMarks: { house: UNGROUNDED, senate: UNGROUNDED },
    relevanceDefaults: await loadRelevanceDefaults(repoRoot()),
    parties: await loadParties(),
    assignSlugs: freshSlugs,
    assignPersonSlugs: freshSlugs,
    openStatesCheckedAt: FIXTURE_NOW.toISOString(),
    legislatorsCheckedAt: FIXTURE_NOW.toISOString(),
    ...overrides,
  };
}
