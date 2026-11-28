// The five pilot state units (PIPE-state-unit items 1, 2, 3, 6 and 7): each state's template,
// registered rules module, fixtures, time-zone entry and legislator mapping, read from the
// committed files and the rules package's public entry. PILOT_EXPECT is written by hand from the
// states' unit records, never computed by the code under test.
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { rulesFor } from '@citizenrun/rules';
import type { Citation, ContestOut, OfficeRef, StateRules, TrackOut } from '@citizenrun/rules';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadTimezones } from '../../lib/data-files.ts';
import { parseYaml } from '../../lib/yaml.ts';
import { mapperFor } from '../../sources/openstates-districts/index.ts';
import { defaultTemplatesDir } from '../../templates/load.ts';
import { StateTemplateSchema } from '../../templates/schema.ts';
import type { StateTemplate } from '../../templates/schema.ts';
import { templateOfficeEntries } from '../../templates/validate.ts';
import { checkTemplates } from '../s03-templates.ts';
import type { TemplateCheckLine } from '../s03-templates.ts';
import { toRulesOfficeRef } from '../shared/office-ref.ts';
import type { OfficeRefRow } from '../shared/office-ref.ts';
import { loadReferenceIds } from '../shared/reference.ts';
import { repoRoot } from '../shared/repo.ts';
import { rulesFixtureInfo } from '../shared/rules-fixtures.ts';

type Chamber = { readonly officeType: 'state-senate' | 'state-house'; readonly highest: number };

type PilotExpect = {
  readonly name: string;
  readonly fips: string;
  /** The listing kinds the state's inventory found. */
  readonly unitKinds: readonly (
    'county' | 'city' | 'township' | 'school_district' | 'special_district'
  )[];
  /** Special districts are outside this state's present scope (D-383, P8-71): no block is written. */
  readonly specialDistrictsDeferred: boolean;
  readonly statewideOfficeTypes: readonly string[];
  /** The inventory's FUNCTION_NAME values for fire, water, hospital and soil-and-water districts. */
  readonly specialDistrictFunctions: readonly string[];
  readonly partySelection: 'primary_ballot' | 'caucus' | 'party_meeting' | 'none';
  readonly countyPay: 'statute' | 'local' | 'mixed';
  readonly chambers: readonly Chamber[];
  readonly pensionBoard: boolean;
};

const FIRE = '24 - LOCAL FIRE PROTECTION';
const FIRE_AND_WATER = '96 - FIRE PROTECTION AND WATER SUPPLY';
const WATER = '91 - WATER SUPPLY UTILITY';
const HOSPITAL = '40 - HOSPITALS';
const SOIL = '88 - SOIL AND WATER CONSERVATION';

const PILOT_EXPECT: Readonly<Record<'NC' | 'WA' | 'TX' | 'LA' | 'VA', PilotExpect>> = {
  NC: {
    name: 'North Carolina',
    fips: '37',
    unitKinds: ['county', 'city', 'school_district', 'special_district'],
    specialDistrictsDeferred: false,
    statewideOfficeTypes: [
      'attorney-general',
      'governor',
      'insurance-commissioner',
      'labor-commissioner',
      'secretary-of-state',
      'state-treasurer',
      'statewide-executive-other',
    ],
    specialDistrictFunctions: [WATER, SOIL, HOSPITAL],
    partySelection: 'party_meeting',
    countyPay: 'local',
    chambers: [
      { officeType: 'state-senate', highest: 50 },
      { officeType: 'state-house', highest: 120 },
    ],
    pensionBoard: false,
  },
  WA: {
    name: 'Washington',
    fips: '53',
    unitKinds: ['county', 'city', 'school_district', 'special_district'],
    specialDistrictsDeferred: false,
    statewideOfficeTypes: [
      'attorney-general',
      'governor',
      'secretary-of-state',
      'statewide-executive-other',
    ],
    specialDistrictFunctions: [FIRE, WATER, HOSPITAL, FIRE_AND_WATER],
    partySelection: 'primary_ballot',
    countyPay: 'local',
    chambers: [
      { officeType: 'state-senate', highest: 49 },
      { officeType: 'state-house', highest: 49 },
    ],
    pensionBoard: false,
  },
  TX: {
    name: 'Texas',
    fips: '48',
    unitKinds: ['county', 'city', 'school_district', 'special_district'],
    specialDistrictsDeferred: true,
    statewideOfficeTypes: [
      'attorney-general',
      'governor',
      'oil-gas-land-commission',
      'state-treasurer',
      'statewide-executive-other',
    ],
    specialDistrictFunctions: [],
    partySelection: 'primary_ballot',
    countyPay: 'local',
    chambers: [
      { officeType: 'state-senate', highest: 31 },
      { officeType: 'state-house', highest: 150 },
    ],
    pensionBoard: false,
  },
  LA: {
    name: 'Louisiana',
    fips: '22',
    unitKinds: ['county', 'city', 'school_district', 'special_district'],
    specialDistrictsDeferred: false,
    statewideOfficeTypes: [
      'attorney-general',
      'governor',
      'insurance-commissioner',
      'secretary-of-state',
      'state-appellate-judge',
      'state-education-board',
      'state-treasurer',
      'statewide-executive-other',
      'utility-commission',
    ],
    specialDistrictFunctions: [FIRE, HOSPITAL, SOIL, WATER],
    partySelection: 'primary_ballot',
    countyPay: 'mixed',
    chambers: [
      { officeType: 'state-senate', highest: 39 },
      { officeType: 'state-house', highest: 105 },
    ],
    pensionBoard: false,
  },
  VA: {
    name: 'Virginia',
    fips: '51',
    unitKinds: ['county', 'city', 'school_district', 'special_district'],
    specialDistrictsDeferred: false,
    statewideOfficeTypes: ['attorney-general', 'governor', 'statewide-executive-other'],
    specialDistrictFunctions: [SOIL, WATER, HOSPITAL],
    partySelection: 'party_meeting',
    countyPay: 'mixed',
    chambers: [
      { officeType: 'state-senate', highest: 40 },
      { officeType: 'state-house', highest: 100 },
    ],
    pensionBoard: false,
  },
};

const YEARS = [2026, 2027, 2028] as const;
const PLAN_TEXT = [/plans\//, /milestone/i, /\bresearch\/\d/, /\bR0\d\b/];

/** One office entry of the template as the rules see it, with its scope's jurisdiction kind. */
type EntryRef = { readonly path: string; readonly ref: OfficeRef };

function refRow(input: {
  key: string | null;
  officeType: string;
  kind: OfficeRefRow['jurisdiction_kind'];
  schedule: string;
  trackSet: string;
  partisan: boolean | null;
  termYears: number | null;
  staggerGroup: string | null;
}): OfficeRefRow {
  return {
    slug: 'fixture-office',
    identity: `fixture|${input.key ?? input.officeType}`,
    origin: 's04-expand',
    template_key: input.key,
    office_type_id: input.officeType,
    jurisdiction_key: 'census:000000',
    jurisdiction_kind: input.kind,
    district_key: 'census:000000',
    county_geoid: null,
    party: null,
    party_selection: null,
    partisan: input.partisan,
    schedule: input.schedule,
    track_set: input.trackSet,
    stagger: [],
    stagger_group: input.staggerGroup,
    seats: 1,
    body_size: null,
    term_years: input.termYears,
    pay_annual_cents: null,
    pay_range: null,
    template_seats: null,
    population: 100_000,
  };
}

/** Every office, chamber and federal entry of the template as a rules OfficeRef. */
function entryRefs(state: string, template: StateTemplate): readonly EntryRef[] {
  const kinds = new Map(template.government_types.map((type) => [type.key, type.kind]));
  const out: EntryRef[] = [];
  for (const { path, entry, scope, ownerKey } of templateOfficeEntries(template)) {
    const kind: OfficeRefRow['jurisdiction_kind'] =
      scope === 'government_type'
        ? (kinds.get(ownerKey) ?? 'county')
        : scope === 'special_district'
          ? 'special_district'
          : scope === 'statewide'
            ? 'state'
            : 'party';
    const row = refRow({
      key: entry.key,
      officeType: entry.office_type,
      kind,
      schedule: entry.schedule,
      trackSet: entry.track_set,
      partisan: entry.partisan?.value ?? null,
      termYears: entry.term_years?.value ?? null,
      staggerGroup: null,
    });
    out.push({ path, ref: toRulesOfficeRef(row, state) });
  }
  template.legislature.forEach((chamber, i) => {
    for (const group of chamber.district_groups) {
      const row = refRow({
        key: null,
        officeType: chamber.office_type,
        kind: 'state',
        schedule: chamber.schedule,
        trackSet: chamber.track_set,
        partisan: chamber.partisan?.value ?? null,
        termYears: chamber.term_years?.value ?? null,
        staggerGroup: group.group,
      });
      out.push({
        path: `legislature.${String(i)}.${group.group}`,
        ref: toRulesOfficeRef(row, state),
      });
    }
  });
  for (const [name, officeType, termYears, group] of [
    ['us_house', 'us-house', 2, null],
    ['us_senate', 'us-senate', 6, 'A'],
  ] as const) {
    const entry = template.federal[name];
    const row = refRow({
      key: null,
      officeType,
      kind: 'state',
      schedule: entry.schedule,
      trackSet: entry.track_set,
      partisan: entry.partisan?.value ?? null,
      termYears,
      staggerGroup: group,
    });
    out.push({ path: `federal.${name}`, ref: toRulesOfficeRef(row, state) });
  }
  return out;
}

/** The citation problems of a rule output, as `<where>: <what>` lines; empty when it is sound. */
function citationProblems(where: string, citation: Citation, contestDate: string): string[] {
  const problems: string[] = [];
  if (!citation.sourceUrl.startsWith('https://')) problems.push(`${where}: source not https`);
  if (citation.quote.trim() === '') problems.push(`${where}: empty quote`);
  if (citation.validFrom > contestDate) problems.push(`${where}: validFrom after the contest`);
  return problems;
}

function trackProblems(where: string, track: TrackOut, contestDate: string): string[] {
  const fields = [
    ['opensOn', track.opensOn],
    ['closesOn', track.closesOn],
    ['closesTime', track.closesTime],
    ['petitionOpens', track.petitionOpens],
    ['petitionDue', track.petitionDue],
    ['fee', track.fee],
    ['signatures', track.signatures],
    ['whereToFile', track.whereToFile],
    ['withdrawalDeadline', track.withdrawalDeadline],
    ...track.alternatives.map((alt, i) => [`alternatives.${String(i)}`, alt.signatures] as const),
  ] as const;
  return fields.flatMap(([name, value]) =>
    value === null
      ? []
      : citationProblems(`${where}.${track.track}.${name}`, value.citation, contestDate),
  );
}

let checkLines: readonly TemplateCheckLine[];

beforeAll(async () => {
  checkLines = await checkTemplates({
    templatesDir: defaultTemplatesDir(),
    rulesFor,
    loadReference: () => loadReferenceIds(repoRoot()),
  });
}, 60_000);

for (const [state, expected] of Object.entries(PILOT_EXPECT)) {
  const st = state.toLowerCase();

  describe(`${state} state unit`, () => {
    let text: string;
    let template: StateTemplate;
    let rules: StateRules;

    beforeAll(async () => {
      text = await readFile(join(defaultTemplatesDir(), `${st}.yaml`), 'utf8');
      template = StateTemplateSchema.parse(parseYaml(text, `data/templates/${st}.yaml`));
      const module = rulesFor(state);
      if (module === null) throw new Error(`no rules module registered for ${state}`);
      rules = module;
    });

    it('item 1: the template validates with the registered module', () => {
      const line = checkLines.find((l) => l.state === state);
      expect(line).toEqual({ state, ok: true, errors: [] });
    });

    it('item 1: every unit kind has a government type', () => {
      const kinds = new Set(template.government_types.map((type) => type.kind));
      for (const kind of expected.unitKinds) {
        if (kind === 'special_district') {
          expect(template.special_districts.length > 0).toBe(!expected.specialDistrictsDeferred);
        } else {
          expect(kinds.has(kind), kind).toBe(true);
        }
      }
    });

    it('item 1: the expected statewide offices are present', () => {
      const present = new Set(template.statewide.map((entry) => entry.office_type));
      expect([...present].sort()).toEqual([...expected.statewideOfficeTypes].sort());
    });

    it('item 1: the first special-district types are decided', () => {
      const classified = new Set(
        template.special_districts.flatMap((block) => block.classifier.function_names),
      );
      const missing = expected.specialDistrictFunctions.filter((name) => !classified.has(name));
      expect(missing).toEqual([]);
    });

    it('item 1: party committee and county pay', () => {
      expect(template.party_committee.selection.value).toBe(expected.partySelection);
      expect(template.county_pay).toBe(expected.countyPay);
      const pension = templateOfficeEntries(template).some(
        ({ entry }) => entry.office_type === 'pension-board',
      );
      expect(pension).toBe(expected.pensionBoard);
    });

    it('item 1: no placeholder and no plan text', () => {
      expect(text.includes('<<placeholder')).toBe(false);
      const lines = text
        .split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => PLAN_TEXT.some((pattern) => pattern.test(line)))
        .map(({ n }) => n);
      expect(lines).toEqual([]);
    });

    it("item 2: every entry's schedule and track set answers", () => {
      const problems: string[] = [];
      let contests = 0;
      for (const { path, ref } of entryRefs(state, template)) {
        for (const year of YEARS) {
          let out: readonly ContestOut[];
          try {
            out = rules.contests({ office: ref, year });
          } catch (error) {
            problems.push(`${path} ${String(year)}: contests threw ${String(error)}`);
            continue;
          }
          for (const contest of out) {
            contests += 1;
            const where = `${path} ${contest.date} ${contest.kind}`;
            problems.push(...citationProblems(`${where} date`, contest.dateCitation, contest.date));
            try {
              for (const track of rules.filingTracks({ office: ref, contest })) {
                problems.push(...trackProblems(where, track, contest.date));
              }
            } catch (error) {
              problems.push(`${where}: filingTracks threw ${String(error)}`);
            }
          }
        }
      }
      expect(problems).toEqual([]);
      expect(contests).toBeGreaterThan(0);
    });

    it('item 2: holidays and certification are cited', () => {
      const problems: string[] = [];
      for (let year = 2024; year <= 2030; year += 1) {
        for (const holiday of rules.holidays(year).holidays) {
          problems.push(
            ...citationProblems(`holiday ${holiday.date}`, holiday.citation, '9999-12-31'),
          );
        }
      }
      let generals = 0;
      for (const { path, ref } of entryRefs(state, template)) {
        if (!path.startsWith('statewide.') && !path.startsWith('federal.')) continue;
        for (const year of YEARS) {
          for (const contest of rules.contests({ office: ref, year })) {
            if (contest.kind !== 'general') continue;
            generals += 1;
            const certified = rules.certificationDate({ office: ref, contest });
            if (certified === null) {
              problems.push(`${path} ${contest.date}: no certification date`);
              continue;
            }
            if (certified.value <= contest.date) {
              problems.push(`${path} ${contest.date}: certified on or before the contest`);
            }
            problems.push(
              ...citationProblems(
                `${path} ${contest.date} certification`,
                certified.citation,
                contest.date,
              ),
            );
          }
        }
      }
      expect(problems).toEqual([]);
      expect(generals).toBeGreaterThan(0);
    });

    it('item 2: county pay where the statute sets it', () => {
      const refs = entryRefs(state, template);
      const byPath = new Map(templateOfficeEntries(template).map((e) => [e.path, e.entry]));
      const problems: string[] = [];
      let countyPayEntries = 0;
      for (const { path, ref } of refs) {
        const entry = byPath.get(path);
        if (template.county_pay === 'local') {
          if (ref.jurisdictionKind !== 'county') continue;
          for (const year of YEARS) {
            if (rules.countyPay({ office: ref, year }) !== null) {
              problems.push(
                `${path} ${String(year)}: county pay where the statute leaves it local`,
              );
            }
          }
          continue;
        }
        if (entry?.pay === null || entry?.pay === undefined || !('rule' in entry.pay)) continue;
        countyPayEntries += 1;
        for (const population of [10_000, 1_000_000]) {
          const pay = rules.countyPay({ office: { ...ref, population }, year: 2026 });
          const where = `${path} population ${String(population)}`;
          if (pay === null) {
            // A mixed state's entry with no cited amount resolves to null, "not known yet" (D-902).
            if (template.county_pay === 'statute') problems.push(`${where}: no county pay`);
            continue;
          }
          if (!Number.isInteger(pay.value.amountCents) || pay.value.amountCents < 0) {
            problems.push(`${where}: an amount that is not whole cents`);
          }
          problems.push(...citationProblems(`${where} county pay`, pay.citation, '9999-12-31'));
        }
      }
      expect(problems).toEqual([]);
      if (template.county_pay !== 'local') expect(countyPayEntries).toBeGreaterThan(0);
    });

    it('item 3: the fixtures are listed and present', async () => {
      const dir = join(repoRoot(), 'packages', 'rules', 'src', '__fixtures__', st);
      const files = (await readdir(dir)).filter((name) => name.endsWith('.fixtures.ts'));
      const index = await readFile(join(dir, 'index.ts'), 'utf8');
      const imports = [...index.matchAll(/from '\.\/([^']+\.fixtures)\.ts'/g)];
      expect(imports.length).toBe(files.length);
      expect(files.length).toBeGreaterThanOrEqual(3);
      await expect(
        access(join(repoRoot(), 'packages', 'rules', 'src', 'states', `${st}.test.ts`)),
      ).resolves.toBeUndefined();
      const info = await rulesFixtureInfo(repoRoot(), state);
      expect(info.files).toBe(files.length);
      expect(info.newestRetrievedOn).not.toBeNull();
    });

    it('item 6: the time zone entry exists', async () => {
      const entry = (await loadTimezones()).find((zone) => zone.state === state);
      expect(entry).toBeDefined();
      expect(entry?.default.startsWith('America/')).toBe(true);
      expect(entry?.source_url.startsWith('https://')).toBe(true);
      expect(entry?.quote.trim()).not.toBe('');
      expect(entry?.citation.trim()).not.toBe('');
    });

    it('item 7: legislators map to districts', () => {
      const mapper = mapperFor(state, expected.fips);
      for (const chamber of expected.chambers) {
        const side = chamber.officeType === 'state-senate' ? 'upper' : 'lower';
        const highest = String(chamber.highest);
        expect(mapper(side, '1')).toBe(`${expected.fips}001`);
        expect(mapper(side, highest)).toBe(`${expected.fips}${highest.padStart(3, '0')}`);
      }
      expect(template.legislature.map((c) => c.office_type)).toEqual(
        expected.chambers.map((c) => c.officeType),
      );
    });

    it('the module answers rulesFor', () => {
      expect(rules.state).toBe(state);
      expect(template.name).toBe(expected.name);
    });
  });
}
