import { beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_CTX,
  NO_PHOTO_OPTIONS,
  OFFICE_HERO_FIXTURES,
  RUN_AGAINST_FIXTURES,
} from '../__fixtures__/office.fixtures.ts';
import { setStrictGlyphs } from '../layout-text.ts';
import { buildOfficeHeroModel } from '../model/office-hero.ts';
import type { RunAgainstModel } from '../model/run-against.ts';
import { officeTopFitProblems, runAgainstFitProblems } from './fit.ts';
import { modelOf, t } from './testing/support.ts';

beforeAll(() => {
  setStrictGlyphs(true);
});

const known = modelOf(RUN_AGAINST_FIXTURES.known);

describe('fit problems', () => {
  it('fixtures keep to their slots', () => {
    for (const data of Object.values(RUN_AGAINST_FIXTURES)) {
      expect(runAgainstFitProblems(modelOf(data))).toEqual([]);
    }
    for (const data of Object.values(OFFICE_HERO_FIXTURES)) {
      expect(
        officeTopFitProblems(buildOfficeHeroModel(data, t, FIXTURE_CTX, NO_PHOTO_OPTIONS)),
      ).toEqual([]);
    }
  });

  it('a problem is found', () => {
    const caption = 'a'.repeat(45);
    const longCaption: RunAgainstModel = { ...known, big: { ...known.big, caption } };
    expect(runAgainstFitProblems(longCaption)).toEqual([
      `caption "${caption}" is over 40 characters`,
    ]);

    const label = 'Votes left to win.';
    expect(label.length).toBe(18);
    const longLabel: RunAgainstModel = {
      ...known,
      facts: [{ ...known.facts[0], label }, known.facts[1]],
    };
    expect(runAgainstFitProblems(longLabel)).toEqual([
      'fact label "VOTES LEFT TO WIN." is over 17 characters',
    ]);

    const line = 'Pay: fixture-county-records.example, Nov';
    expect(line.length).toBe(40);
    const longSource: RunAgainstModel = { ...known, sources: [known.sources[0] ?? '', line] };
    expect(runAgainstFitProblems(longSource)).toEqual([
      `source line "${line}" is over 39 characters`,
    ]);
  });

  it('names each kind of line that leaves its slot', () => {
    const problems = runAgainstFitProblems({
      top: { ...known.top, kicker: { issueId: null, label: 'x'.repeat(31) } },
      big: { kind: 'figure', value: '$123,456,789,012', aboutWord: 'roughly', caption: 'a year' },
      facts: [
        { kind: 'phrase', phrase: 'not known as of yet', label: 'Pay', dateLine: null },
        {
          kind: 'figure',
          value: '1,234,567,890',
          aboutWord: null,
          label: 'Days left to file',
          flag: true,
          dateLine: 'closes Wednesday, Nov 25',
        },
      ],
      sources: [],
    });
    expect(problems).toEqual([
      `kicker label "${'X'.repeat(31)}" is over 30 characters`,
      'big number "$123,456,789,012" does not fit the measure',
      'estimate word "roughly" is over 6 characters',
      'fact phrase "not known as of yet" is over 18 characters',
      'fact figure "1,234,567,890" does not fit its column',
      'fact label "DAYS LEFT TO FILE" is over 16 characters',
      'date line "closes Wednesday, Nov 25" is over 20 characters',
    ]);
  });
});
