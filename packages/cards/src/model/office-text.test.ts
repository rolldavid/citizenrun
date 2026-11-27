import { beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_CTX,
  FIXTURE_OFFICE,
  RUN_AGAINST_FIXTURES,
} from '../__fixtures__/office.fixtures.ts';
import { setStrictGlyphs } from '../layout-text.ts';
import { dataOf, officeWith, t } from '../regions/testing/support.ts';
import {
  electionLineText,
  holderModel,
  kickerModel,
  leadIssueId,
  levelLabel,
  officeTitleText,
  placeAltText,
  placeText,
} from './office-text.ts';

beforeAll(() => {
  setStrictGlyphs(true);
});

const NOT_DRAWABLE = 'Fixture Treasurer of Kaʻū';

describe('office text', () => {
  it('lead issue', () => {
    expect(leadIssueId(FIXTURE_OFFICE)).toBe('property-taxes');
    expect(kickerModel(FIXTURE_OFFICE, t)).toEqual({
      issueId: 'property-taxes',
      label: 'Property taxes',
    });
    // The headline issue wins over the order of the list.
    expect(leadIssueId(officeWith({ headlineIssueId: 'public-money' }))).toBe('public-money');
    expect(leadIssueId(officeWith({ headlineIssueId: null }))).toBe('property-taxes');
    expect(
      leadIssueId(
        officeWith({ headlineIssueId: null, issues: [{ issueId: 'public-money', relevance: 1 }] }),
      ),
    ).toBe('public-money');
    expect(leadIssueId(officeWith({ headlineIssueId: null, issues: [] }))).toBeNull();

    const unknownIssue = officeWith({ headlineIssueId: 'fixture-issue', issues: [] });
    expect(leadIssueId(unknownIssue)).toBeNull();
    expect(kickerModel(unknownIssue, t)).toEqual({ issueId: null, label: 'County office' });
  });

  it('level labels', () => {
    expect(
      (['local', 'county', 'state', 'federal', 'special'] as const).map((level) =>
        levelLabel(level, t),
      ),
    ).toEqual([
      'Local office',
      'County office',
      'State office',
      'Federal office',
      'Special district',
    ]);
  });

  it('title fallbacks', () => {
    expect(officeTitleText(FIXTURE_OFFICE, t)).toBe('County Treasurer');
    expect(officeTitleText(RUN_AGAINST_FIXTURES.titleNotDrawable.office, t)).toBe(
      'County Treasurer',
    );
    expect(
      officeTitleText(officeWith({ title: NOT_DRAWABLE, officeTypeId: 'fixture-office-type' }), t),
    ).toBe('County office');
  });

  it('place and election', () => {
    expect(placeText(FIXTURE_OFFICE, t)).toBe('Fixture Wren County, ZZ');

    const state = officeWith({
      jurisdiction: { ...FIXTURE_OFFICE.jurisdiction, name: 'Fixture Kaʻū', kind: 'state' },
    });
    // The okina is folded to the mark the face has; the alt text keeps the name as written.
    expect(placeText(state, t)).toBe('Fixture Ka‘ū');
    expect(placeAltText(state, t)).toBe('Fixture Kaʻū');

    const nameless = officeWith({
      jurisdiction: { ...FIXTURE_OFFICE.jurisdiction, name: '日本' },
    });
    expect(placeText(nameless, t)).toBe('');

    expect(electionLineText(FIXTURE_OFFICE, t, FIXTURE_CTX)).toBe('Election Apr 6, 2027');
    const election = FIXTURE_OFFICE.nextElection;
    expect(election).not.toBeNull();
    if (election !== null) {
      const lineOf = (kind: typeof election.kind): string =>
        electionLineText(officeWith({ nextElection: { ...election, kind } }), t, FIXTURE_CTX);
      expect(lineOf('primary')).toBe('Primary Apr 6, 2027');
      expect(lineOf('primary_runoff')).toBe('Primary runoff Apr 6, 2027');
      expect(lineOf('general_runoff')).toBe('Runoff Apr 6, 2027');
      expect(lineOf('special')).toBe('Special election Apr 6, 2027');
    }
    expect(
      electionLineText(
        officeWith({ nextElection: null, filingStatus: 'no_election' }),
        t,
        FIXTURE_CTX,
      ),
    ).toBe('No election scheduled');
    expect(
      electionLineText(officeWith({ nextElection: null, filingStatus: 'closed' }), t, FIXTURE_CTX),
    ).toBe('Filing has closed');
  });

  it('holder lines', () => {
    expect(holderModel(dataOf(officeWith({ openSeat: 'term_limited' })), t)).toEqual({
      line1: 'Open seat',
      line2: 'holder is term-limited',
    });
    expect(holderModel(dataOf(officeWith({ openSeat: 'not_running' })), t)?.line2).toBe(
      'holder not running',
    );
    expect(holderModel(dataOf(officeWith({ openSeat: 'vacant' })), t)?.line2).toBe(
      'seat is vacant',
    );
    expect(holderModel(dataOf(FIXTURE_OFFICE), t)).toEqual({
      line1: 'Carol Wynn',
      line2: 'holder since 2019',
    });
    expect(holderModel(dataOf(officeWith({ featuredHolderSince: null })), t)).toEqual({
      line1: 'Carol Wynn',
      line2: 'current holder',
    });
    expect(holderModel(dataOf(officeWith({ featuredOfficeholder: null })), t)).toBeNull();
  });
});
