import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  CandidacyViewSchema,
  ElectionViewSchema,
  FIELD_REPORT_FIELDS,
  FieldReportInputSchema,
  FilingTrackSchema,
  MeetingTimeSchema,
  OFFICE_USER_CONTENT_KEYS,
  OfficeDetailSchema,
  OfficeListPageSchema,
  OfficeSummarySchema,
  PERSON_USER_CONTENT_KEYS,
  PersonDetailSchema,
  PersonSummarySchema,
  ResultViewSchema,
} from './civic.ts';

/** The dot paths of every optional or defaulted key, walking into objects, arrays and nullables; a `fieldMeta` object's own keys are skipped. */
function optionalKeys(schema: z.core.$ZodType, path = ''): string[] {
  if (schema instanceof z.ZodNullable) {
    return optionalKeys(schema.unwrap(), path);
  }
  if (schema instanceof z.ZodArray) {
    return optionalKeys(schema.element, `${path}[]`);
  }
  if (!(schema instanceof z.ZodObject)) {
    return [];
  }
  const found: string[] = [];
  for (const [key, child] of Object.entries(schema.shape)) {
    const at = path === '' ? key : `${path}.${key}`;
    if (child instanceof z.ZodOptional || child instanceof z.ZodDefault) {
      found.push(at);
    } else if (key !== 'fieldMeta') {
      found.push(...optionalKeys(child, at));
    }
  }
  return found;
}

function issuesOf(result: z.ZodSafeParseResult<unknown>) {
  return (result.error?.issues ?? []).map((issue) => ({
    path: issue.path.join('.'),
    code: issue.code,
    params: 'params' in issue ? issue.params : undefined,
  }));
}

describe('civic shapes', () => {
  it('every response key is present', () => {
    const shapes = {
      OfficeSummarySchema,
      OfficeDetailSchema,
      ElectionViewSchema,
      FilingTrackSchema,
      ResultViewSchema,
      PersonSummarySchema,
      PersonDetailSchema,
      CandidacyViewSchema,
      OfficeListPageSchema,
    };
    for (const [name, schema] of Object.entries(shapes)) {
      expect(optionalKeys(schema), name).toEqual([]);
    }
    // The walk finds an optional key where one is.
    expect(optionalKeys(z.object({ a: z.object({ b: z.string().optional() }) }))).toEqual(['a.b']);
  });

  it('the keys inside a fieldMeta object are optional', () => {
    for (const schema of [OfficeSummarySchema, OfficeDetailSchema, FilingTrackSchema]) {
      for (const child of Object.values(schema.shape.fieldMeta.shape)) {
        expect(child).toBeInstanceOf(z.ZodOptional);
      }
    }
  });

  it('office detail holds every summary key', () => {
    const detail = Object.keys(OfficeDetailSchema.shape);
    for (const key of Object.keys(OfficeSummarySchema.shape)) {
      expect(detail, key).toContain(key);
    }
    const person = Object.keys(PersonDetailSchema.shape);
    for (const key of Object.keys(PersonSummarySchema.shape)) {
      expect(person, key).toContain(key);
    }
  });

  it("office detail's fieldMeta has its 21 keys", () => {
    expect(Object.keys(OfficeDetailSchema.shape.fieldMeta.shape).sort()).toEqual(
      [
        'payAnnualCents',
        'payKind',
        'payAmountCents',
        'payPeriod',
        'benefits',
        'hoursPerWeek',
        'fullTime',
        'meetingTimes',
        'payChangeNote',
        'filingFeeCents',
        'signaturesRequired',
        'whereToFile',
        'seats',
        'bodySize',
        'seatsUpNext',
        'termYears',
        'termLimitTerms',
        'partisan',
        'partySelection',
        'electorateCount',
        'filingDeadline',
      ].sort(),
    );
    expect(Object.keys(OfficeDetailSchema.shape.fieldMeta.shape)).toHaveLength(21);
    expect(Object.keys(OfficeSummarySchema.shape.fieldMeta.shape)).toEqual([
      'payAnnualCents',
      'payAmountCents',
      'hoursPerWeek',
      'filingFeeCents',
      'filingDeadline',
    ]);
    expect(Object.keys(FilingTrackSchema.shape.fieldMeta.shape)).toHaveLength(8);
  });

  it('declared runners can only be empty before declarations exist', () => {
    const runners = OfficeDetailSchema.shape.declaredRunners;
    expect(runners.safeParse([]).success).toBe(true);
    expect(runners.safeParse([{ id: 'x' }]).success).toBe(false);
    expect(PersonDetailSchema.shape.claimedBy.safeParse(null).success).toBe(true);
    expect(PersonDetailSchema.shape.claimedBy.safeParse({ id: 'x' }).success).toBe(false);
  });

  it('the shapes have their component ids', () => {
    const ids = {
      OfficeSummary: OfficeSummarySchema,
      OfficeDetail: OfficeDetailSchema,
      ElectionView: ElectionViewSchema,
      FilingTrack: FilingTrackSchema,
      ResultView: ResultViewSchema,
      PersonSummary: PersonSummarySchema,
      PersonDetail: PersonDetailSchema,
      CandidacyView: CandidacyViewSchema,
      OfficeListPage: OfficeListPageSchema,
      FieldReportInput: FieldReportInputSchema,
      MeetingTime: MeetingTimeSchema,
    };
    for (const [id, schema] of Object.entries(ids)) {
      expect(z.globalRegistry.get(schema)?.id).toBe(id);
    }
  });

  it('the meeting times are those L-fits-day-job reads', () => {
    expect(MeetingTimeSchema.options).toEqual(['daytime', 'evenings', 'weekends']);
  });
});

describe('FieldReportInput', () => {
  it('a field report needs a note or a link', () => {
    for (const body of [{}, { message: null, sourceUrl: null }, { field: 'title' }]) {
      expect(issuesOf(FieldReportInputSchema.safeParse(body))).toEqual([
        { path: 'message', code: 'custom', params: { code: 'required' } },
      ]);
    }
    expect(FieldReportInputSchema.parse({ message: 'Fixture note.' })).toEqual({
      message: 'Fixture note.',
    });
    expect(FieldReportInputSchema.parse({ sourceUrl: 'https://example.test/fixture' })).toEqual({
      sourceUrl: 'https://example.test/fixture',
    });
    expect(
      FieldReportInputSchema.safeParse({ field: null, message: 'Fixture note.', sourceUrl: null })
        .success,
    ).toBe(true);
  });

  it('a field report note is trimmed and at most 1,000 characters', () => {
    expect(FieldReportInputSchema.parse({ message: `  ${'a'.repeat(1000)} ` })).toEqual({
      message: 'a'.repeat(1000),
    });
    const tooLong = issuesOf(
      FieldReportInputSchema.safeParse({ message: ` ${'a'.repeat(1001)} ` }),
    );
    expect(tooLong).toEqual([{ path: 'message', code: 'too_big', params: undefined }]);
    expect(FieldReportInputSchema.safeParse({ message: '   ' }).success).toBe(false);
  });

  it('the link is a bounded string and is checked by the service', () => {
    expect(FieldReportInputSchema.safeParse({ sourceUrl: 'http://example.test/x' }).success).toBe(
      true,
    );
    expect(
      FieldReportInputSchema.safeParse({ sourceUrl: `https://example.test/${'a'.repeat(2048)}` })
        .success,
    ).toBe(false);
  });

  it('field report fields are the 24 of the list', () => {
    expect(FIELD_REPORT_FIELDS).toHaveLength(24);
    expect(FIELD_REPORT_FIELDS).toContain('title');
    expect(FIELD_REPORT_FIELDS).toContain('petition_due');
    expect(FIELD_REPORT_FIELDS).not.toContain('fits_day_job');
    expect(new Set(FIELD_REPORT_FIELDS).size).toBe(24);
    expect(FieldReportInputSchema.safeParse({ field: 'fits_day_job', message: 'x' }).success).toBe(
      false,
    );
    expect(
      FieldReportInputSchema.safeParse({ field: 'filing_deadline', message: 'x' }).success,
    ).toBe(true);
  });

  it('user content keys', () => {
    expect(OFFICE_USER_CONTENT_KEYS).toEqual(['declaredRunners', 'declaredRunnersCount']);
    expect(PERSON_USER_CONTENT_KEYS).toEqual(['claimedBy']);
    for (const key of OFFICE_USER_CONTENT_KEYS) {
      expect(Object.keys(OfficeDetailSchema.shape)).toContain(key);
    }
    for (const key of PERSON_USER_CONTENT_KEYS) {
      expect(Object.keys(PersonDetailSchema.shape)).toContain(key);
    }
  });
});
