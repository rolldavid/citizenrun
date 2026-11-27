// Virginia's template expanded in process over Henrico County and the City of Richmond, with the
// state's own rules module (PIPE-state-unit item 1, PIPE-expand, PIPE-deadlines). The expected
// values are written by hand from the template, the capture's listing rows and the published
// fixtures of the rules package.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vaRules } from '@citizenrun/rules/states/va';
import { parse } from 'yaml';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateTemplateText } from '../../templates/validate.ts';
import type { StateTemplate } from '../../templates/schema.ts';
import { loadReferenceIds } from '../shared/reference.ts';
import { repoRoot } from '../shared/repo.ts';
import type { OfficeRefRow } from '../shared/office-ref.ts';
import {
  electionsOf,
  loadPilotUnits,
  officesOf,
  placeholderCount,
  runPilotExpansion,
  tracksOf,
} from './harness.ts';
import type { PilotRun, PilotUnits } from './harness.ts';

const TODAY = '2026-11-16';
const NOW = new Date('2026-11-16T12:00:00.000Z');
const TEMPLATE_PATH = join(repoRoot(), 'data', 'templates', 'va.yaml');
const FIXTURE_DIR = join(repoRoot(), 'pipeline', 'stages', 'pilots', '__fixtures__', 'va');

const HENRICO = 'census:202737';
const RICHMOND = 'census:194178';

/**
 * The capture's stage 2 refs were written before Virginia had a template, so their schedule, track
 * set and partisan flag are null. Stage 2 copies them from the template's legislature and federal
 * entries (PIPE-known-bodies); the test does the same before the run.
 */
function withTemplateEntries(
  refs: readonly OfficeRefRow[],
  template: StateTemplate,
): OfficeRefRow[] {
  const entryOf = (typeId: string) => {
    if (typeId === 'us-house') return template.federal.us_house;
    if (typeId === 'us-senate') return template.federal.us_senate;
    return template.legislature.find((entry) => entry.office_type === typeId) ?? null;
  };
  return refs.map((ref) => {
    const entry = entryOf(ref.office_type_id);
    if (entry === null) return ref;
    return {
      ...ref,
      schedule: entry.schedule,
      track_set: entry.track_set,
      partisan: entry.partisan?.value ?? null,
    };
  });
}

let run: PilotRun;
let units: PilotUnits;
let templateText: string;

beforeAll(async () => {
  templateText = await readFile(TEMPLATE_PATH, 'utf8');
  const template = parse(templateText) as StateTemplate;
  const captured = await loadPilotUnits(FIXTURE_DIR);
  units = { ...captured, knownRefs: withTemplateEntries(captured.knownRefs, template) };
  run = await runPilotExpansion({
    templatePath: TEMPLATE_PATH,
    rules: vaRules,
    units,
    today: TODAY,
    now: NOW,
  });
}, 60_000);

const officeLines = (jurisdictionKey: string) =>
  officesOf(run, jurisdictionKey)
    .map((o) => [o.office_type_id, o.title, o.placeholder])
    .sort(byTitle);

const electionLines = (slug: string) =>
  electionsOf(run, slug).map((e) => [e.election_date, e.kind, e.party]);

function slugOf(jurisdictionKey: string, officeTypeId: string): string {
  const office = officesOf(run, jurisdictionKey).find((o) => o.office_type_id === officeTypeId);
  if (office === undefined) throw new Error(`no ${officeTypeId} office in ${jurisdictionKey}`);
  return office.slug;
}

function knownSlug(identity: string): string {
  const ref = units.knownRefs.find((r) => r.identity === identity);
  if (ref === undefined) throw new Error(`no known ref ${identity}`);
  return ref.slug;
}

describe('VA pilot expansion', () => {
  it('the template validates with the state module', async () => {
    const ids = await loadReferenceIds(repoRoot());
    const result = validateTemplateText(templateText, {
      state: 'VA',
      officeTypeIds: ids.officeTypeIds,
      powerIds: ids.powerIds,
      rules: vaRules,
      isFixture: false,
    });
    expect(result.ok ? [] : result.errors).toEqual([]);
    expect(run.expand.checks.find((c) => c.name === 'slug_unique')?.passed).toBe(true);
  });

  it('Henrico and Richmond get their constitutional officers', () => {
    // Henrico's county manager form has no elected treasurer or commissioner of the revenue.
    expect(officeLines(HENRICO)).toEqual(
      [
        ['sheriff', 'Henrico County Sheriff', false],
        ['district-attorney', "Henrico County Commonwealth's Attorney", false],
        ['county-row-other', 'Henrico County Clerk of the Circuit Court', false],
      ].sort(byTitle),
    );
    expect(officeLines(RICHMOND)).toEqual(
      [
        ['sheriff', 'Richmond city Sheriff', false],
        ['district-attorney', "Richmond city Commonwealth's Attorney", false],
        ['county-treasurer', 'Richmond city Treasurer', false],
        ['county-assessor', 'Richmond city Commissioner of the Revenue', false],
        ['county-row-other', 'Richmond city Clerk of the Circuit Court', false],
      ].sort(byTitle),
    );
    // A city's officers are offices of the city, never of a county.
    const officers = new Set([
      'sheriff',
      'district-attorney',
      'county-treasurer',
      'county-assessor',
      'county-row-other',
    ]);
    expect(
      run.expand.offices
        .filter((o) => officers.has(o.office_type_id) && o.jurisdiction_key !== HENRICO)
        .map((o) => o.jurisdiction_key),
    ).toEqual([RICHMOND, RICHMOND, RICHMOND, RICHMOND, RICHMOND]);
  });

  it('counties and cities elect their officers in alternate odd years', () => {
    expect(electionLines(slugOf(HENRICO, 'sheriff'))).toEqual([
      ['2027-06-15', 'primary', 'democratic'],
      ['2027-06-15', 'primary', 'republican'],
      ['2027-11-02', 'general', null],
    ]);
    expect(electionLines(slugOf(RICHMOND, 'sheriff'))).toEqual([
      ['2025-11-04', 'general', null],
      ['2029-06-19', 'primary', 'democratic'],
      ['2029-06-19', 'primary', 'republican'],
      ['2029-11-06', 'general', null],
    ]);
    // Clerks serve eight years: the cities' clerks stand in 2027, the counties' in 2023 and 2031.
    expect(electionLines(slugOf(RICHMOND, 'county-row-other'))).toEqual([
      ['2027-06-15', 'primary', 'democratic'],
      ['2027-06-15', 'primary', 'republican'],
      ['2027-11-02', 'general', null],
    ]);
    expect(electionLines(slugOf(HENRICO, 'county-row-other'))).toEqual([]);
  });

  it('the 2025 statewide general is in the window', () => {
    const delegate = knownSlug('state:VA|state-house|tiger:sldl:51001');
    expect(electionLines(delegate)).toEqual([
      ['2025-11-04', 'general', null],
      ['2027-06-15', 'primary', 'democratic'],
      ['2027-06-15', 'primary', 'republican'],
      ['2027-11-02', 'general', null],
      ['2029-06-19', 'primary', 'democratic'],
      ['2029-06-19', 'primary', 'republican'],
      ['2029-11-06', 'general', null],
    ]);
    const governor = slugOf('state:VA', 'governor');
    expect(electionLines(governor)).toEqual([
      ['2025-11-04', 'general', null],
      ['2029-06-19', 'primary', 'democratic'],
      ['2029-06-19', 'primary', 'republican'],
      ['2029-11-06', 'general', null],
    ]);
    expect(officeLines('state:VA')).toEqual(
      [
        ['governor', 'Governor', false],
        ['statewide-executive-other', 'Lieutenant Governor', false],
        ['attorney-general', 'Attorney General', false],
      ].sort(byTitle),
    );
    const senator = knownSlug('state:VA|state-senate|tiger:sldu:51001');
    expect(electionLines(senator)).toEqual([
      ['2027-06-15', 'primary', 'democratic'],
      ['2027-06-15', 'primary', 'republican'],
      ['2027-11-02', 'general', null],
    ]);
  });

  it('the published 2026 primary window', () => {
    // The 2026 US Senate primary moved to 4 August; its filing window is the published one of
    // packages/rules/src/__fixtures__/va/2026-us-senate.fixtures.ts, copied by hand.
    const senator = knownSlug('state:VA|us-senate:class-2|tiger:state:51');
    const primaries = electionsOf(run, senator).filter((e) => e.kind === 'primary');
    expect(primaries.map((e) => [e.election_date, e.party])).toEqual([
      ['2026-08-04', 'democratic'],
      ['2026-08-04', 'republican'],
    ]);
    for (const primary of primaries) {
      expect(
        tracksOf(run, primary.source_key).map((t) => [
          t.track,
          t.opens_on,
          t.closes_on,
          t.closes_time,
        ]),
      ).toEqual([['party_primary', '2026-03-16', '2026-04-02', '17:00']]);
    }
    const general = electionsOf(run, senator).find((e) => e.kind === 'general');
    expect(general?.election_date).toBe('2026-11-03');
    expect(
      tracksOf(run, general?.source_key ?? '').map((t) => [t.track, t.closes_on, t.closes_time]),
    ).toEqual([['independent', '2026-06-16', '19:00']]);
  });

  it('partisan offices get a party-primary and an independent track', () => {
    const sheriff = slugOf(HENRICO, 'sheriff');
    for (const election of electionsOf(run, sheriff)) {
      const tracks = tracksOf(run, election.source_key).map((t) => t.track);
      expect(tracks).toEqual([election.kind === 'primary' ? 'party_primary' : 'independent']);
    }
  });

  it('every active unit of an elected type is an office holder or a placeholder', () => {
    // From the capture's listing: Henrico County and Richmond city hold offices; the two school
    // divisions are placeholders (each locality chooses whether its school board is elected); the
    // Henricopolis district holds its directors; the Central Virginia Transportation Authority
    // (public mass transit) has no block and is a placeholder. The waste management authority, the
    // toll highway authority, the hospital authority, the jail authority and the airport commission
    // have appointed boards and get no office.
    const appointed = [
      'census:114595', // Central Virginia Waste Management Authority
      'census:136088', // Richmond Metropolitan Transportation Authority
      'census:158754', // Richmond Eye and Ear Hospital Authority
      'census:195485', // Peumansend Creek Regional Jail Authority
      'census:207308', // Capital Region Airport Commission
    ];
    for (const key of appointed) {
      expect(officesOf(run, key)).toEqual([]);
    }
    const census = units.jurisdictions.filter((j) => j.source_key.startsWith('census:'));
    expect(census).toHaveLength(11);
    for (const unit of census) {
      if (appointed.includes(unit.source_key)) continue;
      const offices = officesOf(run, unit.source_key);
      const placeholders = offices.filter((o) => o.placeholder);
      expect(offices.length > 0 && (placeholders.length === 0 || offices.length === 1)).toBe(true);
    }
    expect(placeholderCount(run, 'school_district')).toBe(2);
    expect(placeholderCount(run, 'special_district')).toBe(1);
    expect(placeholderCount(run, 'county')).toBe(0);
    expect(placeholderCount(run, 'city')).toBe(0);
    expect(officesOf(run, 'census:251599').map((o) => o.placeholder)).toEqual([true]);
  });

  it('soil and water directors are elected in 2027', () => {
    const directors = officesOf(run, 'census:158713');
    expect(directors.map((o) => [o.office_type_id, o.title, o.seats, o.placeholder])).toEqual([
      [
        'soil-water-conservation-board',
        'Henricopolis Soil and Water Conservation District Director',
        3,
        false,
      ],
    ]);
    const elections = electionsOf(run, directors[0]?.slug ?? '');
    expect(elections.map((e) => [e.election_date, e.kind, e.party])).toEqual([
      ['2027-11-02', 'general', null],
    ]);
    expect(tracksOf(run, elections[0]?.source_key ?? '').map((t) => t.track)).toEqual([
      'nonpartisan',
    ]);
  });

  it('party chairs per county and party, chosen by the parties', () => {
    const party = run.expand.jurisdictions
      .filter((j) => j.kind === 'party')
      .map((j) => j.source_key);
    expect([...party].sort()).toEqual([
      'party:VA:51087:democratic',
      'party:VA:51087:republican',
      'party:VA:51760:democratic',
      'party:VA:51760:republican',
    ]);
    for (const key of party) {
      const offices = officesOf(run, key);
      expect(offices.map((o) => [o.office_type_id, o.party_selection])).toEqual([
        ['party-committee', 'party_meeting'],
      ]);
      expect(electionsOf(run, offices[0]?.slug ?? '')).toEqual([]);
    }
  });

  it('the rules are plausible', () => {
    const check = (name: string) => run.deadlines.checks.find((c) => c.name === name);
    expect(check('rules_plausible')?.passed).toBe(true);
    expect(check('ref_missing')?.passed ?? true).toBe(true);
    expect(run.expand.checks.find((c) => c.name === 'template_pattern')?.passed).toBe(true);
  });
});

function byTitle(a: readonly unknown[], b: readonly unknown[]): number {
  return String(a[1]) < String(b[1]) ? -1 : String(a[1]) > String(b[1]) ? 1 : 0;
}
