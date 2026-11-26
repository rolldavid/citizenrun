import { describe, expect, it } from 'vitest';
import { zzTemplate } from '../../__fixtures__/s04/zz-template-output.ts';
import type { GovernmentType, StateTemplate } from '../../templates/schema.ts';
import { TemplatePatternError, matchUnit, templatePatternErrors } from './match.ts';
import type { ExpandUnit } from './units.ts';

function unit(fields: Partial<ExpandUnit>): ExpandUnit {
  return {
    key: 'census:990100',
    kind: 'county',
    name: 'Fixture Unit',
    population: null,
    censusActive: true,
    timezone: null,
    unitTypeCode: null,
    functionName: null,
    schoolLevel: null,
    countyGeoid: '99001',
    placeGeoid: null,
    ownDistrictKey: 'tiger:county:99001',
    exactViaKeys: ['tiger:county:99001'],
    ...fields,
  };
}

async function template(edit?: (t: StateTemplate) => void): Promise<StateTemplate> {
  const t = structuredClone(await zzTemplate());
  edit?.(t);
  return t;
}

/** A copy of the template's township type (elected false, no offices) under another key and kind. */
function typeLike(t: StateTemplate, fields: Partial<GovernmentType>): GovernmentType {
  const township = t.government_types.find((type) => type.key === 'township');
  if (township === undefined) {
    throw new Error('the fixture template has no township type');
  }
  return { ...structuredClone(township), ...fields };
}

describe('matchUnit', () => {
  it('the first matching government type wins', async () => {
    const t = await template((tt) => {
      tt.government_types.push(
        typeLike(tt, { key: 'county-any', kind: 'county', unit_type_codes: null }),
      );
    });
    expect(matchUnit(unit({ unitTypeCode: 1 }), t)).toEqual({ kind: 'government_type', index: 0 });
    expect(matchUnit(unit({ unitTypeCode: 7 }), t)).toEqual({ kind: 'government_type', index: 3 });
    expect(matchUnit(unit({ kind: 'city', unitTypeCode: 2 }), t)).toEqual({
      kind: 'government_type',
      index: 1,
    });
    expect(matchUnit(unit({ kind: 'school_district' }), t)).toEqual({ kind: 'none' });
  });

  it('school_levels narrows', async () => {
    const t = await template((tt) => {
      tt.government_types.push(
        typeLike(tt, {
          key: 'elementary',
          kind: 'school_district',
          unit_type_codes: null,
          school_levels: ['Elementary school system only'],
        }),
        typeLike(tt, { key: 'any-school', kind: 'school_district', unit_type_codes: null }),
      );
    });
    const school = (schoolLevel: string | null) => unit({ kind: 'school_district', schoolLevel });
    expect(matchUnit(school('Elementary school system only'), t)).toEqual({
      kind: 'government_type',
      index: 3,
    });
    expect(matchUnit(school('Secondary school system only'), t)).toEqual({
      kind: 'government_type',
      index: 4,
    });
    expect(matchUnit(school(null), t)).toEqual({ kind: 'government_type', index: 4 });
  });

  it('a special district matches by function name and a case-insensitive name pattern', async () => {
    const t = await template();
    const water = unit({ kind: 'special_district', functionName: '91 - Water supply utility' });
    expect(matchUnit({ ...water, name: 'FIXTURE WATER DISTRICT' }, t)).toEqual({
      kind: 'special_district',
      index: 1,
    });
    expect(matchUnit({ ...water, name: 'Fixture Waterfront District' }, t)).toEqual({
      kind: 'none',
    });
    expect(
      matchUnit(unit({ kind: 'special_district', functionName: '24 - Fire protection' }), t),
    ).toEqual({ kind: 'special_district', index: 0 });
    expect(matchUnit(unit({ kind: 'special_district', functionName: '61 - Library' }), t)).toEqual({
      kind: 'none',
    });
  });

  it('a pattern that does not compile fails template_pattern', async () => {
    const t = await template((tt) => {
      const block = tt.special_districts[1];
      if (block !== undefined) {
        block.classifier.name_patterns = ['(unclosed'];
      }
    });
    expect(templatePatternErrors(t)).toEqual(['special_districts.1.classifier.name_patterns.0']);
    const water = unit({ kind: 'special_district', functionName: '91 - Water supply utility' });
    expect(() => matchUnit(water, t)).toThrow(TemplatePatternError);
    expect(templatePatternErrors(await template())).toEqual([]);
  });
});
