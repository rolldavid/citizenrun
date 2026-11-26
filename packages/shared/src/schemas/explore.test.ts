import { describe, expect, it } from 'vitest';
import { ISSUE_IDS } from '../design/issues.ts';
import { ListOfficesQuerySchema, parseOfficeListQuery } from './explore.ts';

function parsed(query: Record<string, string>) {
  return parseOfficeListQuery(ListOfficesQuerySchema.parse(query));
}

function issuesAt(query: Record<string, string>, path: string) {
  return (ListOfficesQuerySchema.safeParse(query).error?.issues ?? [])
    .filter((issue) => issue.path.join('.') === path)
    .map((issue) => ('params' in issue ? issue.params?.['code'] : issue.code));
}

describe('ListOfficesQuery', () => {
  it('comma lists split', () => {
    expect(parsed({ issue: 'rent-housing,climate' }).issue).toEqual(['rent-housing', 'climate']);
    expect(parsed({ level: 'local,county' }).level).toEqual(['local', 'county']);
    expect(parsed({ officeType: 'county-commission,school-board' }).officeType).toEqual([
      'county-commission',
      'school-board',
    ]);
    expect(parsed({ jurisdictionKind: 'school_district,coop' }).jurisdictionKind).toEqual([
      'school_district',
      'coop',
    ]);
  });

  it('an unknown issue is refused', () => {
    expect(issuesAt({ issue: 'rent-housing,fixture-unknown' }, 'issue')).toEqual(['invalid_value']);
  });

  it('eleven issues are refused', () => {
    const ten = ISSUE_IDS.slice(0, 10).join(',');
    expect(ListOfficesQuerySchema.safeParse({ issue: ten }).success).toBe(true);
    const eleven = ISSUE_IDS.slice(0, 11).join(',');
    expect(issuesAt({ issue: eleven }, 'issue')).toContain('invalid_format');
  });

  it('list values outside their vocabulary or count are refused', () => {
    expect(ListOfficesQuerySchema.safeParse({ level: 'local,city' }).success).toBe(false);
    expect(
      ListOfficesQuerySchema.safeParse({ level: 'local,county,state,federal,special,local' })
        .success,
    ).toBe(false);
    expect(ListOfficesQuerySchema.safeParse({ level: '' }).success).toBe(false);
    expect(ListOfficesQuerySchema.safeParse({ officeType: 'County-Commission' }).success).toBe(
      false,
    );
    expect(
      ListOfficesQuerySchema.safeParse({
        officeType: Array.from({ length: 11 }, (_, i) => `type-${String(i)}`).join(','),
      }).success,
    ).toBe(false);
    expect(ListOfficesQuerySchema.safeParse({ jurisdictionKind: 'town' }).success).toBe(false);
  });

  it('booleans parse from text', () => {
    expect(parsed({ fitsDayJob: 'true', includeContained: 'false' })).toMatchObject({
      fitsDayJob: true,
      includeContained: false,
    });
    expect(parsed({ fitsDayJob: 'false' }).fitsDayJob).toBe(false);
    expect(parsed({}).includeContained).toBe(true);
    expect(parsed({})).not.toHaveProperty('fitsDayJob');
    expect(ListOfficesQuerySchema.safeParse({ fitsDayJob: 'yes' }).success).toBe(false);
  });

  it('limit defaults to 20 and stops at 50', () => {
    expect(parsed({}).limit).toBe(20);
    expect(parsed({ limit: '50' }).limit).toBe(50);
    expect(ListOfficesQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(ListOfficesQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
  });

  it('the sort defaults to opportunity', () => {
    expect(parsed({}).sort).toBe('opportunity');
    expect(parsed({ sort: 'deadline' }).sort).toBe('deadline');
    expect(ListOfficesQuerySchema.safeParse({ sort: 'name' }).success).toBe(false);
  });

  it('no score filter is accepted', () => {
    const query = ListOfficesQuerySchema.parse({ minImpact: '5', minEase: '7' });
    expect(query).not.toHaveProperty('minImpact');
    expect(query).not.toHaveProperty('minEase');
    expect(parseOfficeListQuery(query)).toEqual({
      includeContained: true,
      sort: 'opportunity',
      limit: 20,
    });
  });

  it('numbers and text keep their bounds', () => {
    expect(parsed({ minPay: '0', maxHours: '80', deadlineWithin: '365' })).toMatchObject({
      minPay: 0,
      maxHours: 80,
      deadlineWithin: 365,
    });
    for (const query of [
      { minPay: '-1' },
      { minPay: '100000001' },
      { maxHours: '81' },
      { deadlineWithin: '0' },
      { q: '   ' },
      { q: 'a'.repeat(101) },
      { state: 'nc' },
      { district: 'not-a-uuid' },
      { scope: 'county' },
      { cursor: 'c'.repeat(513) },
    ]) {
      expect(ListOfficesQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false);
    }
    expect(parsed({ q: '  Fixture board  ' }).q).toBe('Fixture board');
    expect(parsed({ state: 'ZZ', scope: 'state' })).toMatchObject({ state: 'ZZ', scope: 'state' });
  });
});
