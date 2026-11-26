import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { einCandidates } from '../stages/s02-coops.ts';
import { coopsSample } from './eia861.fixtures.ts';
import { EOBMF_COLUMNS, EoHeaderError, normaliseOrgName, readEoRows } from './irs-eobmf.ts';

const body = (text: string | Uint8Array) => Readable.from(Buffer.from(text));

describe('normaliseOrgName', () => {
  it('folds the co-op spellings, abbreviations, punctuation and company tokens', () => {
    expect(normaliseOrgName('The Fixture Elec. Co-op, Inc.')).toBe('fixture electric cooperative');
    expect(normaliseOrgName('Fixture Electric Assn & Power LLC')).toBe(
      'fixture electric association and power',
    );
    expect(normaliseOrgName('FIXTURE ELECTRIC COOP CORP')).toBe('fixture electric cooperative');
    expect(normaliseOrgName('Fixture  Rural-Electric Corporation')).toBe('fixture ruralelectric');
  });
});

describe('the EO BMF reader', () => {
  it('the header check fails without SUBSECTION', async () => {
    const text = 'EIN,NAME,CITY,STATE\n990000001,FIXTURE ELECTRIC COOPERATIVE,FIXTURE CITY,ZZ\n';
    await expect(readEoRows(body(text))).rejects.toBeInstanceOf(EoHeaderError);
  });

  it('only the five columns are read', async () => {
    const text = [
      'EIN,NAME,ICO,STREET,CITY,STATE,ZIP,SUBSECTION,NTEE_CD',
      '990000001,FIXTURE ELECTRIC COOPERATIVE,FIXTURE CARE OF,1 FIXTURE WAY,FIXTURE CITY,ZZ,99999,12,',
    ].join('\n');
    const rows = await readEoRows(body(`${text}\n`));
    expect(rows).toEqual([
      {
        ein: '990000001',
        name: 'FIXTURE ELECTRIC COOPERATIVE',
        city: 'FIXTURE CITY',
        state: 'ZZ',
        subsection: '12',
      },
    ]);
    expect(Object.keys(rows[0] ?? {})).toHaveLength(EOBMF_COLUMNS.length);
  });

  it('the saved Colorado excerpt gives one candidate for one co-op and none for the other', async () => {
    const rows = await readEoRows(body(await coopsSample('eo-co-excerpt.csv')));
    expect(rows).toHaveLength(4);
    expect(
      einCandidates({ name: 'Empire Electric Assn, Inc' }, rows).map((row) => row.ein),
    ).toEqual(['846035888']);
    // The IRS writes the name with a hyphen that EIA does not; no fuzzy match is made.
    expect(einCandidates({ name: 'Delta Montrose Electric Assn' }, rows)).toEqual([]);
  });

  it('a row of another subsection is never a candidate', () => {
    const rows = [
      {
        ein: '990000001',
        name: 'FIXTURE ELECTRIC COOPERATIVE',
        city: 'X',
        state: 'ZZ',
        subsection: '03',
      },
    ];
    expect(einCandidates({ name: 'Fixture Electric Coop' }, rows)).toEqual([]);
  });
});
