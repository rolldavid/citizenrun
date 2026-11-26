import { describe, expect, it } from 'vitest';
import { writeXlsx } from '../lib/xlsx.ts';
import { storedZip } from '../lib/zip.fixtures.ts';
import { makeS02Coops } from '../stages/s02-coops.ts';
import type { StageOutput } from '../lib/runner.ts';
import { scriptedRun } from './dataset.fixtures.ts';
import {
  EIA_URL,
  EiaHeaderError,
  customersReadable,
  eiaColumnSources,
  eiaTerritory,
  eiaUtilities,
  headerIndex,
  normaliseCountyName,
  readEia861Zip,
  resolveCounties,
  retailCustomers,
} from './eia861.ts';
import {
  FIXTURE_STATE_FIPS,
  eiaFixtureFiles,
  fixtureCounties,
  workbookRows,
} from './eia861.fixtures.ts';

describe('the EIA-861 rows', () => {
  it('selects the two Colorado cooperatives with their counties', async () => {
    const files = await eiaFixtureFiles();
    const utilities = eiaUtilities(files);
    expect(utilities.map((u) => [u.utilityNumber, u.state, u.ownership])).toEqual([
      ['5086', 'CO', 'cooperative'],
      ['5862', 'CO', 'cooperative'],
    ]);
    expect(utilities.map((u) => u.name)).toEqual([
      'Delta Montrose Electric Assn',
      'Empire Electric Assn, Inc',
    ]);
    const { resolved, unresolved } = resolveCounties(
      eiaTerritory(files),
      await fixtureCounties(),
      FIXTURE_STATE_FIPS,
      [],
    );
    // Delta, Gunnison, Montrose and Ouray; Dolores, Montezuma and San Miguel.
    expect(resolved.get('5086')).toEqual(['08029', '08051', '08085', '08091']);
    expect(resolved.get('5862')).toEqual(['08033', '08083', '08113']);
    // San Juan, Utah: the fixture holds no Utah county.
    expect(unresolved).toEqual([{ utilityNumber: '5862', state: 'UT', county: 'San Juan' }]);
  });

  it('St Bernard resolves in Louisiana', async () => {
    const { resolved, unresolved } = resolveCounties(
      [{ utilityNumber: '1', state: 'LA', county: 'St Bernard' }],
      await fixtureCounties(),
      FIXTURE_STATE_FIPS,
      [],
    );
    expect(resolved.get('1')).toEqual(['22087']);
    expect(unresolved).toEqual([]);
  });

  it('an override wins over the name rule', async () => {
    const files = await eiaFixtureFiles();
    const { resolved } = resolveCounties(
      eiaTerritory(files),
      await fixtureCounties(),
      FIXTURE_STATE_FIPS,
      [{ state: 'CO', eia_name: 'Delta', geoids: ['08001'] }],
    );
    expect(resolved.get('5086')).toEqual(['08001', '08051', '08085', '08091']);
  });

  it('a name two counties share resolves to neither', () => {
    const { resolved, unresolved } = resolveCounties(
      [{ utilityNumber: '1', state: 'ZZ', county: 'Fixture' }],
      [
        { geoid: '99001', statefp: '99', name: 'Fixture' },
        { geoid: '99003', statefp: '99', name: 'Fixture County' },
      ],
      new Map([['ZZ', '99']]),
      [],
    );
    expect(resolved.size).toBe(0);
    expect(unresolved).toHaveLength(1);
  });

  it('normaliseCountyName', () => {
    expect(normaliseCountyName('St Bernard')).toBe('st. bernard');
    expect(normaliseCountyName('St. Bernard Parish')).toBe('st. bernard');
    expect(normaliseCountyName('Ste Genevieve')).toBe('ste. genevieve');
    expect(normaliseCountyName('Matanuska Susitna')).toBe('matanuska susitna');
    expect(normaliseCountyName('Matanuska-Susitna Borough')).toBe('matanuskasusitna');
    expect(normaliseCountyName('Fixture City and Borough')).toBe('fixture');
    expect(normaliseCountyName('  Fixture   County ')).toBe('fixture');
    expect(normaliseCountyName('East St Fixture')).toBe('east st. fixture');
    expect(normaliseCountyName('Fixture County County')).toBe('fixture county');
  });

  it('a sheet without a Utility Number header fails eia_header', async () => {
    const noHeader = [{ sheet: 'States', rowNumber: 1, values: ['Data Year', 'Utility Name'] }];
    expect(() => headerIndex(noHeader)).toThrow(EiaHeaderError);

    const sheet = (rows: (string | number | null)[][]) => writeXlsx([{ name: 'States', rows }]);
    const zip = storedZip([
      {
        name: 'Utility_Data_2025.xlsx',
        data: await sheet([['Data Year', 'Number', 'Utility Name', 'State', 'Ownership Type']]),
      },
      {
        name: 'Service_Territory_2025.xlsx',
        data: await sheet([
          ['Data Year', 'Utility Number', 'Utility Name', 'Short Form', 'State', 'County'],
        ]),
      },
    ]);
    const { ctx } = scriptedRun((url) =>
      url === EIA_URL ? { kind: 'body', contentType: 'application/zip', body: zip } : undefined,
    );
    await ctx.bucket.putBytes('datasets/eia861/2025/fixture.zip', zip, 'application/zip');
    await expect(readEia861Zip(ctx, 'datasets/eia861/2025/fixture.zip')).rejects.toBeInstanceOf(
      EiaHeaderError,
    );

    const written: string[] = [];
    const out: StageOutput = {
      writeRows(name) {
        written.push(name);
        return Promise.resolve({ name, rows: 0, sha256: '0'.repeat(64) });
      },
    };
    const module = makeS02Coops({ countyAttributes: () => Promise.resolve([]) });
    const result = await module.run(ctx, 'CO', { dryRun: false, out });
    expect(result.checks).toEqual([{ name: 'eia_header', passed: false, detail: 'header' }]);
    expect(written).toEqual([]);
  });

  it('retail customers are summed per utility', async () => {
    const files = await eiaFixtureFiles();
    // 5086: one row, TOTAL customers 37,301. 5862: Colorado 15,986 and Utah 1,308.
    expect(retailCustomers(files.salesUltCust)).toEqual(
      new Map([
        ['5086', 37301],
        ['5862', 15986 + 1308],
      ]),
    );
    expect(customersReadable(files.salesUltCust)).toBe(true);
  });

  it('a customers file without the TOTAL group gives an empty map', async () => {
    const rows = await workbookRows(
      await writeXlsx([
        {
          name: 'States',
          rows: [
            ['Data Year', 'Utility Number', 'Utility Name', 'Customers'],
            [2025, 99999, 'Fixture Electric Cooperative', 1000],
          ],
        },
      ]),
    );
    expect(retailCustomers(rows).size).toBe(0);
    expect(customersReadable(rows)).toBe(false);
    expect(customersReadable(null)).toBe(false);
  });

  it('the 2025 members carry no city or website column', async () => {
    const files = await eiaFixtureFiles();
    expect(eiaColumnSources(files)).toEqual({ city: null, website: null });
    expect(eiaUtilities(files).every((u) => u.city === null && u.website === null)).toBe(true);
  });

  it('a City and a Website column are read where a member has them', async () => {
    const rows = await workbookRows(
      await writeXlsx([
        {
          name: 'States',
          rows: [
            ['Utility Characteristics', null, null, null, null, null, null],
            [
              'Data Year',
              'Utility Number',
              'Utility Name',
              'State',
              'Ownership Type',
              'City',
              'Utility Website',
            ],
            [
              2025,
              99999,
              'Fixture Electric Cooperative',
              'ZZ',
              'Cooperative',
              'Fixture City',
              'https://coop.example.test',
            ],
            [
              2025,
              99998,
              'Fixture Public Power District',
              'ZZ',
              'Political Subdivision',
              null,
              null,
            ],
          ],
        },
      ]),
    );
    const files = { utilityData: rows, shortForm: null, serviceTerritory: [], salesUltCust: null };
    expect(eiaUtilities(files)).toEqual([
      {
        utilityNumber: '99999',
        name: 'Fixture Electric Cooperative',
        state: 'ZZ',
        ownership: 'cooperative',
        city: 'Fixture City',
        website: 'https://coop.example.test',
      },
      {
        utilityNumber: '99998',
        name: 'Fixture Public Power District',
        state: 'ZZ',
        ownership: 'political_subdivision',
        city: null,
        website: null,
      },
    ]);
    expect(eiaColumnSources(files)).toEqual({
      city: 'Utility_Data_2025/States/City',
      website: 'Utility_Data_2025/States/Utility Website',
    });
  });
});
