import { FRIDAY, daysBefore, federalHolidays, weekdayOf } from '@citizenrun/rules';
import type { BElection } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import {
  COMMISSION,
  COMMISSION_REF,
  COUNCIL_1,
  COUNCIL_1_REF,
  ZZ_ELECTIONS,
  ZZ_NOW,
} from '../../__fixtures__/s05/zz-elections.ts';
import { ZZ_RULES_IMPLAUSIBLE } from '../../__fixtures__/s05/zz-rules-implausible.ts';
import { ZZ_RULES } from '../../templates/__fixtures__/zz-rules.ts';
import type { OfficeRefRow } from '../shared/office-ref.ts';
import { tracksFor } from './tracks.ts';

const CODE_URL = 'https://example.test/zz/code';
const NOW_ISO = '2026-11-16T12:00:00.000Z';

function electionOf(key: string): BElection {
  const found = ZZ_ELECTIONS.find((e) => e.source_key === key);
  if (found === undefined) {
    throw new Error(`no fixture election ${key}`);
  }
  return found;
}

function run(
  election: BElection,
  ref: OfficeRefRow = COMMISSION_REF,
  newestRetrievedOn: string | null = null,
) {
  return tracksFor({ election, ref, state: 'ZZ', rules: ZZ_RULES, now: ZZ_NOW, newestRetrievedOn });
}

function meta(code: number, quote: string, checkedAt = NOW_ISO) {
  return {
    source_url: CODE_URL,
    quote: `Fixture text: ${quote}`,
    confidence: 'medium',
    checked_at: checkedAt,
    rule_citation: `ZZ Fixture Code ${String(code)}`,
  };
}

const PRIMARY_2028 = `${COMMISSION}|2028-05-02|primary|democratic`;
const GENERAL_2028 = `${COMMISSION}|2028-11-07|general|`;

describe('tracksFor', () => {
  it('a partisan primary gets one party-primary track with its fee and proof', () => {
    // 2028-05-02 minus 90 days is 2028-02-02; minus 60 days is 2028-03-03, a Friday, so no roll.
    expect(weekdayOf('2028-03-03')).toBe(FRIDAY);
    const result = run(electionOf(PRIMARY_2028));
    expect(result.implausible).toEqual([]);
    expect(result.kept).toEqual([
      {
        source_key: `${PRIMARY_2028}|party_primary`,
        election_key: PRIMARY_2028,
        track: 'party_primary',
        opens_on: '2028-02-02',
        closes_on: '2028-03-03',
        closes_time: null,
        petition_opens: null,
        petition_due: null,
        fee_cents: 45_000, // 1% of 4,500,000
        signatures: 0, // `none` is a real zero
        where_to_file: 'Fixture County Board of Elections',
        basis: 'computed',
        source_url: CODE_URL,
        quote:
          'Fixture text: a party candidate files from the 90th day to the 60th day before the primary.',
        rule_citation: 'ZZ Fixture Code 105',
        confidence: 'medium',
        checked_at: NOW_ISO,
        field_meta: {
          fee_cents: meta(
            106,
            'a party candidate pays a filing fee of one percent of the annual salary of the office.',
          ),
          signatures: meta(112, 'a party or nonpartisan candidate files no petition.'),
          where_to_file: meta(107, 'candidates file with the county board of elections.'),
        },
      },
    ]);
  });

  it('an independent track keeps its stated closing hour', () => {
    // 2028-11-07 minus 120 days is 2028-07-10; minus 75 days is 2028-08-24, a Thursday.
    const result = run(electionOf(GENERAL_2028));
    expect(result.kept).toHaveLength(1);
    const track = result.kept[0];
    expect(track).toMatchObject({
      source_key: `${GENERAL_2028}|independent`,
      track: 'independent',
      opens_on: '2028-07-10',
      closes_on: '2028-08-24',
      closes_time: '12:00',
      fee_cents: 10_000,
      signatures: 200,
      where_to_file: null,
      rule_citation: 'ZZ Fixture Code 108',
      confidence: 'medium',
    });
    // opens_on shares the closing date's citation and takes no entry of its own.
    expect(track?.field_meta).toEqual({
      closes_time: meta(109, 'an independent candidate files by noon on the last day of filing.'),
      fee_cents: meta(110, 'an independent candidate pays a filing fee of 100 dollars.'),
      signatures: meta(111, 'an independent candidate files a petition of 200 voters.'),
    });
  });

  it('a fee percent of unknown pay is null', () => {
    const result = run(electionOf(PRIMARY_2028), { ...COMMISSION_REF, pay_annual_cents: null });
    const track = result.kept[0];
    expect(track?.fee_cents).toBeNull();
    expect(track?.signatures).toBe(0);
    expect(track?.field_meta).not.toHaveProperty('fee_cents');
    expect(Object.keys(track?.field_meta ?? {}).sort()).toEqual(['signatures', 'where_to_file']);
  });

  it('a closing date that falls on a holiday rolls', () => {
    // Independence Day 2028 is a Tuesday, observed on the day; 60 days before 2028-09-02.
    expect(federalHolidays(2028).map((h) => h.date)).toContain('2028-07-04');
    expect(daysBefore('2028-09-02', 60)).toBe('2028-07-04');
    const contest: BElection = {
      ...electionOf(PRIMARY_2028),
      source_key: `${COMMISSION}|2028-09-02|primary|democratic`,
      election_date: '2028-09-02',
    };
    const result = run(contest);
    expect(result.kept.map((t) => [t.opens_on, t.closes_on])).toEqual([
      ['2028-06-04', '2028-07-05'],
    ]);
  });

  it('checked_at is the newest fixture retrieval', () => {
    const result = run(electionOf(PRIMARY_2028), COMMISSION_REF, '2026-11-15');
    const track = result.kept[0];
    expect(track?.checked_at).toBe('2026-11-15T00:00:00.000Z');
    expect(track?.confidence).toBe('medium');
    expect(Object.values(track?.field_meta ?? {}).map((m) => m.checked_at)).toEqual([
      '2026-11-15T00:00:00.000Z',
      '2026-11-15T00:00:00.000Z',
      '2026-11-15T00:00:00.000Z',
    ]);
  });

  it('a fixture retrieval older than 180 days lowers the track to low', () => {
    const result = run(electionOf(PRIMARY_2028), COMMISSION_REF, '2026-05-01');
    expect(result.kept[0]?.confidence).toBe('low');
    expect(result.kept[0]?.source_url).toBe(CODE_URL);
  });

  it('a closing date after the election is dropped with its rule', () => {
    const election = electionOf(`${COUNCIL_1}|2027-11-02|general|`);
    expect(run(election, COUNCIL_1_REF).kept).toHaveLength(1);
    const result = tracksFor({
      election,
      ref: COUNCIL_1_REF,
      state: 'ZZ',
      rules: ZZ_RULES_IMPLAUSIBLE,
      now: ZZ_NOW,
      newestRetrievedOn: null,
    });
    expect(result.kept).toEqual([]);
    expect(result.implausible).toEqual([
      { sourceKey: `${COUNCIL_1}|2027-11-02|general||nonpartisan`, rule: 'closes_after_election' },
    ]);
  });

  it('a contest with no filing gets no track', () => {
    // The commission's party track set files nothing for a general under zz_party.
    const result = run(electionOf(GENERAL_2028), { ...COMMISSION_REF, track_set: 'zz_party' });
    expect(result).toEqual({ kept: [], implausible: [] });
  });
});
