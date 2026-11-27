import { createI18n } from '@citizenrun/shared';
import type { ElectionView, FieldMeta, FilingTrack, TFunction } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';

import {
  deadlineDate,
  deadlineInputOfElection,
  deadlineInputOfTrack,
  presentDeadlineBlock,
} from './present-deadline-block';
import type { DeadlineInput } from './present-deadline-block';

// The typed t accepts catalog keys only; the presenter passes each key as a plain string.
const t = createI18n().getFixedT('en') as unknown as TFunction;
// Noon on Sunday, November 15 in New York.
const ctx = { locale: 'en', now: new FakeClock('2026-11-15T17:00:00.000Z').now() };

const onOpenSource = (): void => undefined;

// Every source here is invented: the pages of Fixture Wren County.
const PROOF: FieldMeta = {
  sourceUrl: 'https://wrencounty.example/elections/filing',
  quote: 'Filing closes at 5:00 pm on November 27.',
  confidence: 'high',
  checkedAt: '2026-11-09T15:00:00.000Z',
  ruleCitation: null,
};

function input(window: Partial<DeadlineInput['window']>, over: Partial<DeadlineInput> = {}) {
  const whole: DeadlineInput = {
    window: {
      opensOn: null,
      closesOn: '2026-11-27',
      closesTime: null,
      zone: 'America/New_York',
      ...window,
    },
    proof: PROOF,
    conflict: null,
    onOpenSource,
    itemKey: 'office:fixture',
    testID: 'probe.deadline',
    sourceTestID: 'probe.deadline-source',
    ...over,
  };
  return whole;
}

const CONFLICT: NonNullable<ElectionView['deadlineConflict']> = [
  {
    track: 'nonpartisan',
    field: 'closes_on',
    computed: { value: '2026-11-27', ruleCitation: 'Fixture Code 10-2' },
    scraped: {
      value: '2026-11-30',
      sourceUrl: 'https://elections.wrencounty.example/calendar',
      quote: 'Candidate filing closes November 30.',
      checkedAt: '2026-11-09T15:00:00.000Z',
    },
  },
];

describe('presentDeadlineBlock', () => {
  it('open with a sourced time', () => {
    expect(presentDeadlineBlock(input({ closesTime: '17:00' }), t, ctx)).toEqual({
      state: 'open',
      daysLeft: 12,
      headline: 'Filing closes in 12 days',
      flagLabel: null,
      lines: ['Closes Fri, Nov 27 at 5:00 pm Eastern.'],
      source: {
        confidence: 'high',
        text: 'wrencounty.example. Checked Nov 9.',
        onPress: onOpenSource,
        testID: 'probe.deadline-source',
      },
      caution: 'Confirm with your election office.',
      conflict: null,
      itemKey: 'office:fixture',
      testID: 'probe.deadline',
    });
  });

  it('open without a time', () => {
    const props = presentDeadlineBlock(input({}), t, ctx);
    expect(props.lines).toEqual(['Closes Fri, Nov 27.']);
    // No hour anywhere: none is assumed.
    const words = [props.headline, ...props.lines, props.flagLabel ?? '', props.caution].join(' ');
    expect(words).not.toMatch(/\d:\d\d|\bam\b|\bpm\b|noon|midnight|end of day|Eastern/iu);
  });

  it('seven days flags', () => {
    const five = presentDeadlineBlock(input({ closesOn: '2026-11-20' }), t, ctx);
    expect(five.daysLeft).toBe(5);
    expect(five.flagLabel).toBe('5 days to file');
    expect(presentDeadlineBlock(input({ closesOn: '2026-11-22' }), t, ctx).flagLabel).toBe(
      '7 days to file',
    );
    expect(presentDeadlineBlock(input({ closesOn: '2026-11-23' }), t, ctx).flagLabel).toBeNull();
    expect(presentDeadlineBlock(input({ closesOn: '2026-11-16' }), t, ctx).flagLabel).toBe(
      '1 day to file',
    );
    // A window that is not open is never flagged, however near it is.
    const soon = input({ opensOn: '2026-11-16', closesOn: '2026-11-18' });
    expect(presentDeadlineBlock(soon, t, ctx).flagLabel).toBeNull();
  });

  it('not open yet', () => {
    const props = presentDeadlineBlock(
      input({ opensOn: '2026-12-01', closesOn: '2026-12-15' }),
      t,
      ctx,
    );
    expect(props.state).toBe('not_open');
    expect(props.daysLeft).toBeNull();
    expect(props.headline).toBe('Filing opens in 16 days');
    expect(props.lines).toEqual(['Opens Tue, Dec 1.', 'Closes Tue, Dec 15.']);
    expect(props.source).not.toBeNull();
  });

  it('closed', () => {
    const props = presentDeadlineBlock(input({ closesOn: '2026-11-02' }), t, ctx);
    expect(props.state).toBe('closed');
    expect(props.daysLeft).toBeNull();
    expect(props.flagLabel).toBeNull();
    expect(props.lines).toEqual(['Closed Mon, Nov 2.']);
    expect(props.source).toEqual({
      confidence: 'high',
      text: 'wrencounty.example. Checked Nov 9.',
      onPress: onOpenSource,
      testID: 'probe.deadline-source',
    });
    expect(props.caution).toBe('Confirm with your election office.');
  });

  it('unknown', () => {
    const props = presentDeadlineBlock(input({ closesOn: null, opensOn: '2026-11-02' }), t, ctx);
    expect(props.state).toBe('unknown');
    expect(props.headline).toBe('Filing deadline not known yet');
    expect(props.lines).toEqual([]);
    expect(props.source).toBeNull();
    expect(props.flagLabel).toBeNull();
    expect(props.caution).toBe('Confirm with your election office.');
  });

  it('a known window with no proof has no source row', () => {
    expect(presentDeadlineBlock(input({}, { proof: null }), t, ctx).source).toBeNull();
  });

  it("next year's date carries the year", () => {
    const props = presentDeadlineBlock(input({ closesOn: '2027-02-05' }), t, ctx);
    expect(props.lines).toEqual(['Closes Feb 5, 2027.']);
    expect(deadlineDate('2027-02-05', 'America/New_York', ctx)).toBe('Feb 5, 2027');
    expect(deadlineDate('2026-11-27', 'America/New_York', ctx)).toBe('Fri, Nov 27');
    // The year is the zone's: in Honolulu it is still 2026 when UTC has turned to 2027.
    const newYear = { locale: 'en', now: new FakeClock('2027-01-01T03:00:00.000Z').now() };
    expect(deadlineDate('2026-12-31', 'Pacific/Honolulu', newYear)).toBe('Thu, Dec 31');
    expect(deadlineDate('2026-12-31', 'Etc/UTC', newYear)).toBe('Dec 31, 2026');
  });

  it('a conflict names both dates', () => {
    const props = presentDeadlineBlock(input({}, { conflict: CONFLICT }), t, ctx);
    expect(props.conflict).toBe(
      'Two sources give different dates: Fri, Nov 27 under Fixture Code 10-2, and Mon, Nov 30 from elections.wrencounty.example. The earlier date is shown.',
    );

    const [entry] = CONFLICT;
    if (entry === undefined) {
      throw new Error('the fixture holds one conflict');
    }
    const noCitation = [{ ...entry, computed: { ...entry.computed, ruleCitation: null } }];
    expect(presentDeadlineBlock(input({}, { conflict: noCitation }), t, ctx).conflict).toBe(
      'Two sources give different dates: Fri, Nov 27 by the rule, and Mon, Nov 30 from elections.wrencounty.example. The earlier date is shown.',
    );
    const noLink = [{ ...entry, scraped: { ...entry.scraped, sourceUrl: null } }];
    expect(presentDeadlineBlock(input({}, { conflict: noLink }), t, ctx).conflict).toBe(
      'Two sources give different dates: Fri, Nov 27 and Mon, Nov 30. The earlier date is shown.',
    );

    // The entry about the closing date is the one worded, wherever it stands.
    const opens = {
      ...entry,
      field: 'opens_on',
      computed: { ...entry.computed, value: '2026-11-02' },
    };
    expect(
      presentDeadlineBlock(input({}, { conflict: [opens, entry] }), t, ctx).conflict,
    ).toContain('Fri, Nov 27 under Fixture Code 10-2');
    // Nothing to word: no entry, or a value that is missing.
    expect(presentDeadlineBlock(input({}, { conflict: [] }), t, ctx).conflict).toBeNull();
    const oneSided = [{ ...entry, scraped: { ...entry.scraped, value: null } }];
    expect(presentDeadlineBlock(input({}, { conflict: oneSided }), t, ctx).conflict).toBeNull();
    // A conflict over something that is not a date has no sentence here.
    const hours = [
      {
        ...entry,
        field: 'closes_time',
        computed: { ...entry.computed, value: '17:00' },
        scraped: { ...entry.scraped, value: '12:00' },
      },
    ];
    expect(presentDeadlineBlock(input({}, { conflict: hours }), t, ctx).conflict).toBeNull();
  });

  it('zone fallback', () => {
    // 03:00 UTC on November 16 is still November 15 in New York, the zone used when none is given.
    const late = { locale: 'en', now: new FakeClock('2026-11-16T03:00:00.000Z').now() };
    const props = presentDeadlineBlock(input({ zone: null, closesTime: '17:00' }), t, late);
    expect(props.daysLeft).toBe(12);
    expect(presentDeadlineBlock(input({ zone: 'Etc/UTC' }), t, late).daysLeft).toBe(11);
    // A closing hour with no zone names none.
    expect(props.lines).toEqual(['Closes Fri, Nov 27 at 5:00 pm local time.']);
  });
});

describe('the deadline inputs', () => {
  const TRACK: FilingTrack = {
    id: '01890000-0000-7000-8000-000000000105',
    track: 'nonpartisan',
    opensOn: '2026-11-02',
    closesOn: '2026-11-27',
    closesTime: '17:00',
    timezone: 'America/Chicago',
    petitionOpens: null,
    petitionDue: null,
    feeCents: 5000,
    signatures: 25,
    whereToFile: null,
    basis: 'both',
    sourceUrl: PROOF.sourceUrl,
    quote: PROOF.quote,
    ruleCitation: null,
    confidence: 'high',
    checkedAt: PROOF.checkedAt,
    fieldMeta: { closesOn: PROOF },
  };
  const ELECTION: ElectionView = {
    id: '01890000-0000-7000-8000-000000000104',
    officeId: '01890000-0000-7000-8000-000000000101',
    electionDate: '2027-04-06',
    electionDateMeta: null,
    kind: 'general',
    party: null,
    turnoutClass: 'spring_local',
    filingOpens: '2026-11-02',
    filingDeadline: { date: '2026-11-27', time: '17:00', timezone: 'America/Chicago' },
    petitionDue: null,
    deadlineBasis: 'both',
    deadlineConflict: CONFLICT,
    filingStatus: 'open',
    tracks: [TRACK],
    candidatesCount: 0,
  };
  const OFFICE = {
    fieldMeta: { filingDeadline: PROOF },
    jurisdiction: {
      id: '01890000-0000-7000-8000-000000000102',
      name: 'Fixture Wren County',
      kind: 'county',
      state: 'ZZ',
      website: null,
      timezone: 'America/New_York',
    },
  } as const;

  it('an election gives its headline window, the office its proof', () => {
    expect(deadlineInputOfElection(ELECTION, OFFICE)).toEqual({
      window: {
        opensOn: '2026-11-02',
        closesOn: '2026-11-27',
        closesTime: '17:00',
        zone: 'America/Chicago',
      },
      proof: PROOF,
      conflict: CONFLICT,
    });
    // With no deadline the zone is the jurisdiction's, and there is no proof to show.
    expect(
      deadlineInputOfElection(
        { ...ELECTION, filingDeadline: null, deadlineConflict: null },
        { ...OFFICE, fieldMeta: {} },
      ),
    ).toEqual({
      window: {
        opensOn: '2026-11-02',
        closesOn: null,
        closesTime: null,
        zone: 'America/New_York',
      },
      proof: null,
      conflict: null,
    });
    // A deadline with no zone of its own is read in the jurisdiction's.
    expect(
      deadlineInputOfElection(
        { ...ELECTION, filingDeadline: { date: '2026-11-27', time: null, timezone: null } },
        OFFICE,
      ).window.zone,
    ).toBe('America/New_York');
  });

  it('a track gives its own window and proof, and no conflict', () => {
    expect(deadlineInputOfTrack(TRACK)).toEqual({
      window: {
        opensOn: '2026-11-02',
        closesOn: '2026-11-27',
        closesTime: '17:00',
        zone: 'America/Chicago',
      },
      proof: PROOF,
      conflict: null,
    });
    expect(deadlineInputOfTrack({ ...TRACK, fieldMeta: {} }).proof).toBeNull();
  });
});
