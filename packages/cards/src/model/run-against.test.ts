import { beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_CTX,
  FIXTURE_OFFICE,
  RUN_AGAINST_FIXTURES,
} from '../__fixtures__/office.fixtures.ts';
import { setStrictGlyphs } from '../layout-text.ts';
import { dataOf, deadlineOn, modelOf, officeWith, t } from '../regions/testing/support.ts';
import { officeSourceLines } from '../text/source-line.ts';
import { altText, altTextSentences, buildRunAgainstModel } from './run-against.ts';

beforeAll(() => {
  setStrictGlyphs(true);
});

const PAY_LINE = 'Pay: wrencounty.example, Nov 9.';
const FILING_LINE = 'Filing: wrencounty.example, Nov 9.';
const VOTES_LINE = 'Votes: estimate from population.';
const KNOWN_ALT =
  'County Treasurer, Fixture Wren County, ZZ. Held by Carol Wynn since 2019. Pays $52,900 a year. ' +
  'About 2,100 votes to win. Filing closes in 12 days, on Friday, November 27, 2026.';

describe('buildRunAgainstModel', () => {
  it('the known card', () => {
    expect(modelOf(RUN_AGAINST_FIXTURES.known)).toEqual({
      top: {
        kicker: { issueId: 'property-taxes', label: 'Property taxes' },
        title: 'County Treasurer',
        place: 'Fixture Wren County, ZZ',
        electionLine: 'Election Apr 6, 2027',
        holder: { line1: 'Carol Wynn', line2: 'holder since 2019' },
        sticker: null,
        photoHref: null,
        illustrationId: 'county-treasurer',
      },
      big: {
        kind: 'figure',
        value: '$52,900',
        aboutWord: null,
        caption: 'a year · about 20 hours a week',
      },
      facts: [
        {
          kind: 'figure',
          value: '2,100',
          aboutWord: 'about',
          label: 'Votes to win',
          flag: false,
          dateLine: null,
        },
        {
          kind: 'figure',
          value: '12',
          aboutWord: null,
          label: 'Days to file',
          flag: false,
          dateLine: 'closes Fri, Nov 27',
        },
      ],
      sources: [PAY_LINE, FILING_LINE],
    });
  });

  it('the other fixtures', () => {
    const unknown = modelOf(RUN_AGAINST_FIXTURES.allUnknown);
    expect(unknown.top.kicker).toEqual({ issueId: null, label: 'County office' });
    expect(unknown.top.holder).toBeNull();
    expect(unknown.top.electionLine).toBe('Election Apr 6, 2027');
    expect(unknown.big).toEqual({ kind: 'unknown', phrase: 'not known yet', caption: 'pay' });
    expect(unknown.sources).toEqual([]);

    const low = modelOf(RUN_AGAINST_FIXTURES.lowConfidence);
    expect(low.big).toMatchObject({ value: '$52,900', aboutWord: 'about' });
    expect(low.facts[1]).toMatchObject({ value: '12', aboutWord: null });

    expect(modelOf(RUN_AGAINST_FIXTURES.longTitle).top.illustrationId).toBe('water-district-board');
    expect(modelOf(RUN_AGAINST_FIXTURES.titleNotDrawable).top.title).toBe('County Treasurer');
  });

  it('sources choose two', () => {
    expect(modelOf(RUN_AGAINST_FIXTURES.known).sources).toEqual([PAY_LINE, FILING_LINE]);

    // The votes line is there too, and has no row while pay and filing take both.
    expect(officeSourceLines(FIXTURE_OFFICE, t, FIXTURE_CTX).map((entry) => entry.field)).toEqual([
      'pay',
      'filing',
      'votes',
    ]);

    const { payAnnualCents: _pay, ...withoutPay } = FIXTURE_OFFICE.fieldMeta;
    expect(modelOf(dataOf(officeWith({ fieldMeta: withoutPay }))).sources).toEqual([
      FILING_LINE,
      VOTES_LINE,
    ]);
    expect(modelOf(dataOf(officeWith({ fieldMeta: {} }))).sources).toEqual([VOTES_LINE]);
    expect(modelOf(dataOf(officeWith({ fieldMeta: {}, votesEstimated: false }))).sources).toEqual([
      'Votes: past election results.',
    ]);
  });

  it('photo through the options', () => {
    const options = {
      stickerAllowed: false,
      photoHrefFor: () => 'https://media.example/p.jpg',
    };
    expect(
      buildRunAgainstModel(RUN_AGAINST_FIXTURES.known, t, FIXTURE_CTX, options).top.photoHref,
    ).toBe('https://media.example/p.jpg');
    expect(
      buildRunAgainstModel(
        { ...RUN_AGAINST_FIXTURES.known, featuredPerson: null },
        t,
        FIXTURE_CTX,
        options,
      ).top.photoHref,
    ).toBeNull();
  });
});

describe('altText', () => {
  it('alt text sentences', () => {
    expect(altText(RUN_AGAINST_FIXTURES.known, t, FIXTURE_CTX)).toBe(KNOWN_ALT);
    expect(altTextSentences(RUN_AGAINST_FIXTURES.known, t, FIXTURE_CTX)).toEqual([
      'County Treasurer, Fixture Wren County, ZZ.',
      'Held by Carol Wynn since 2019.',
      'Pays $52,900 a year.',
      'About 2,100 votes to win.',
      'Filing closes in 12 days, on Friday, November 27, 2026.',
    ]);
    expect(altText(RUN_AGAINST_FIXTURES.allUnknown, t, FIXTURE_CTX)).toBe(
      'County Treasurer, Fixture Wren County, ZZ. Pay not known yet. Votes to win not known yet. ' +
        'Filing deadline not known yet.',
    );
    // The alt text has the title as written, though the canvas draws the office type's name.
    expect(altTextSentences(RUN_AGAINST_FIXTURES.titleNotDrawable, t, FIXTURE_CTX)[0]).toBe(
      'Fixture Treasurer of Kaʻū, Fixture Wren County, ZZ.',
    );
    expect(altTextSentences(dataOf(officeWith({ openSeat: 'vacant' })), t, FIXTURE_CTX)[1]).toBe(
      'Open seat.',
    );
    expect(
      altTextSentences(
        dataOf(officeWith({ filingDeadline: deadlineOn('2026-11-15') })),
        t,
        FIXTURE_CTX,
      ).at(-1),
    ).toBe('Filing closes today.');
  });

  it('the other sentences', () => {
    const sentences = (overrides: Parameters<typeof officeWith>[0]): string[] =>
      altTextSentences(dataOf(officeWith(overrides)), t, FIXTURE_CTX);
    expect(altTextSentences(RUN_AGAINST_FIXTURES.lowConfidence, t, FIXTURE_CTX)[2]).toBe(
      'Pays about $52,900 a year.',
    );
    expect(sentences({ featuredHolderSince: null })[1]).toBe('Held by Carol Wynn.');
    expect(
      sentences({
        payAnnualCents: null,
        payKind: 'per_meeting',
        payAmountCents: 10000,
        payPeriod: 'meeting',
      })[2],
    ).toBe('Pays $100 per meeting.');
    expect(
      sentences({
        payAnnualCents: null,
        payKind: 'stipend',
        payAmountCents: 60000,
        payPeriod: 'month',
      })[2],
    ).toBe('Pays $600 a month.');
    expect(sentences({ payKind: 'none' })[2]).toBe('Unpaid.');
    expect(sentences({ votesEstimated: false })[3]).toBe('2,100 votes to win.');
    expect(sentences({ filingDeadline: deadlineOn('2026-11-14') }).at(-1)).toBe(
      'Filing is closed.',
    );
    expect(sentences({ filingDeadline: null, filingStatus: 'no_election' }).at(-1)).toBe(
      'No election is scheduled.',
    );
  });
});
