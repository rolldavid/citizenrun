import { createI18n } from '@citizenrun/shared';
import type { CandidacyView, PersonSummary, TFunction } from '@citizenrun/shared';
import { FakeClock } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';

import type { PersonEntry } from '@/lib/view-models/common.types';

import { presentPersonRow } from './present-person-row';

// The typed t accepts catalog keys only; the presenter passes each key as a plain string.
const t = createI18n().getFixedT('en') as unknown as TFunction;
const ctx = { locale: 'en', now: new FakeClock('2026-11-15T17:00:00.000Z').now() };

// Every person here is invented.
const CAROL: PersonSummary = {
  id: '01890000-0000-7000-8000-000000000111',
  slug: 'carol-wynn',
  name: 'Carol Wynn',
  party: 'democratic',
  photo: null,
  photoCredit: null,
  claimed: false,
  rosterOnly: false,
  retiredAt: null,
  viewer: { following: false },
};

function entryOf(over: Partial<PersonSummary> = {}, href: string | null = '/c/carol-wynn') {
  const entry: PersonEntry = { person: { ...CAROL, ...over }, href, onToggleFollow: null };
  return entry;
}

function candidacy(status: CandidacyView['status'], filedOn: string | null): CandidacyView {
  return {
    id: '01890000-0000-7000-8000-000000000121',
    person: CAROL,
    office: {
      id: '01890000-0000-7000-8000-000000000101',
      slug: 'county-treasurer-wren',
      title: 'County Treasurer',
      state: 'ZZ',
      jurisdictionName: 'Fixture Wren County',
      retiredAt: null,
    },
    electionId: '01890000-0000-7000-8000-000000000104',
    electionDate: '2027-04-06',
    electionKind: 'general',
    electionParty: null,
    party: null,
    status,
    statusHistory: [],
    filedOn,
    sourceUrl: null,
  };
}

describe('presentPersonRow', () => {
  it('holder in a partisan office', () => {
    expect(
      presentPersonRow(
        {
          kind: 'holder',
          entry: entryOf(),
          partisan: true,
          since: '2019-01-01',
          seatLabel: 'Seat 3',
          testID: 'probe.holder',
        },
        t,
        ctx,
      ),
    ).toEqual({
      image: null,
      name: 'Carol Wynn',
      handle: null,
      line: 'Holder since 2019',
      tag: { label: 'Democratic', variant: 'outline' },
      action: null,
      href: '/c/carol-wynn',
      testID: 'probe.holder',
    });
    // A party the catalog has no word for is shown as it is stored.
    const other = presentPersonRow(
      {
        kind: 'holder',
        entry: entryOf({ party: 'working_families' }),
        partisan: true,
        since: null,
        seatLabel: null,
        testID: 'probe.holder',
      },
      t,
      ctx,
    );
    expect(other.tag).toEqual({ label: 'working families', variant: 'outline' });
  });

  it('holder in a nonpartisan office', () => {
    const row = (partisan: boolean | null, party: string | null) =>
      presentPersonRow(
        {
          kind: 'holder',
          entry: entryOf({ party }),
          partisan,
          since: '2019-01-01',
          seatLabel: null,
          testID: 'probe.holder',
        },
        t,
        ctx,
      );
    expect(row(false, 'democratic').tag).toBeNull();
    // Not known to be partisan is not partisan, and no party is no tag.
    expect(row(null, 'democratic').tag).toBeNull();
    expect(row(true, null).tag).toBeNull();
  });

  it('holder with no start year', () => {
    const row = (seatLabel: string | null) =>
      presentPersonRow(
        {
          kind: 'holder',
          entry: entryOf(),
          partisan: false,
          since: null,
          seatLabel,
          testID: 'probe.holder',
        },
        t,
        ctx,
      );
    expect(row('Seat 3').line).toBe('Seat 3');
    expect(row(null).line).toBe('Current holder');
  });

  it('candidate statuses', () => {
    const tagOf = (status: CandidacyView['status']) =>
      presentPersonRow(
        {
          kind: 'candidate',
          entry: entryOf(),
          candidacy: candidacy(status, '2026-11-05'),
          testID: 'probe.candidate',
        },
        t,
        ctx,
      ).tag;
    expect(tagOf('filed')).toEqual({ label: 'Filed', variant: 'solid' });
    expect(tagOf('qualified')).toEqual({ label: 'Qualified', variant: 'solid' });
    expect(tagOf('on_ballot')).toEqual({ label: 'On the ballot', variant: 'solid' });
    expect(tagOf('advanced')).toEqual({ label: 'Advanced', variant: 'solid' });
    expect(tagOf('won')).toEqual({ label: 'Won', variant: 'solid' });
    expect(tagOf('committee_registered')).toEqual({
      label: 'Committee registered',
      variant: 'outline',
    });
    expect(tagOf('withdrawn')).toEqual({ label: 'Withdrew', variant: 'outline' });
    expect(tagOf('disqualified')).toEqual({ label: 'Disqualified', variant: 'outline' });
    expect(tagOf('lost')).toEqual({ label: 'Lost', variant: 'outline' });
    // A status a newer server sends is shown as sent, in the quiet form.
    const newer = 'under_review' as CandidacyView['status']; // not in this build's list
    expect(tagOf(newer)).toEqual({ label: 'under review', variant: 'outline' });

    const filed = presentPersonRow(
      {
        kind: 'candidate',
        entry: entryOf(),
        candidacy: candidacy('filed', '2026-11-05'),
        testID: 'probe.candidate',
      },
      t,
      ctx,
    );
    expect(filed.line).toBe('Filed Nov 5 · created from public filings');
    // A candidate's row never carries a party tag, only the status.
    expect(filed.tag?.label).toBe('Filed');
    const undated = presentPersonRow(
      {
        kind: 'candidate',
        entry: entryOf(),
        candidacy: candidacy('qualified', null),
        testID: 'probe.candidate',
      },
      t,
      ctx,
    );
    expect(undated.line).toBe('Created from public filings');

    // A registered committee is not a filing, whatever date the record carries.
    const committee = presentPersonRow(
      {
        kind: 'candidate',
        entry: entryOf(),
        candidacy: candidacy('committee_registered', '2026-11-05'),
        testID: 'probe.candidate',
      },
      t,
      ctx,
    );
    expect(committee.line).toBe('Registered a campaign committee');
    expect(`${committee.line ?? ''} ${committee.tag?.label ?? ''}`).not.toMatch(/filed/iu);
  });

  it('roster-only and no photo', () => {
    const roster = presentPersonRow(
      {
        kind: 'holder',
        entry: entryOf({ rosterOnly: true }, null),
        partisan: false,
        since: null,
        seatLabel: null,
        testID: 'probe.holder',
      },
      t,
      ctx,
    );
    expect(roster.href).toBeNull();
    expect(roster.image).toBeNull();
    expect(roster.handle).toBeNull();
    expect(roster.action).toBeNull();

    const withPhoto = presentPersonRow(
      {
        kind: 'candidate',
        entry: entryOf({
          photo: {
            kind: 'image',
            key: 'people/fixture/carol-wynn.jpg',
            url: 'https://media.example/people/fixture/carol-wynn.jpg',
            width: 640,
            height: 640,
            blurhash: null,
            thumb: null,
            poster: null,
            durationMs: null,
          },
        }),
        candidacy: candidacy('filed', null),
        testID: 'probe.candidate',
      },
      t,
      ctx,
    );
    expect(withPhoto.image).toEqual({
      key: 'people/fixture/carol-wynn.jpg',
      url: 'https://media.example/people/fixture/carol-wynn.jpg',
    });
    expect(withPhoto.testID).toBe('probe.candidate');
  });
});
