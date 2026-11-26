import { describe, expect, it } from 'vitest';
import { FieldReportExportRowSchema } from './field-report-export.ts';

const ROW = {
  report_id: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
  office_slug: 'zz-fixture-county-board-of-commissioners',
  field: 'pay_annual_cents',
  source_url: 'https://example.test/fixture-report',
  created_at: '2026-11-16T03:00:00.000Z',
};

describe('FieldReportExportRowSchema', () => {
  it('a valid row passes', () => {
    expect(FieldReportExportRowSchema.safeParse(ROW).success).toBe(true);
  });

  it('refuses a user id or a message', () => {
    expect(FieldReportExportRowSchema.safeParse({ ...ROW, user_id: ROW.report_id }).success).toBe(
      false,
    );
    expect(
      FieldReportExportRowSchema.safeParse({ ...ROW, message: 'Fixture message.' }).success,
    ).toBe(false);
  });

  it('refuses an http link', () => {
    expect(
      FieldReportExportRowSchema.safeParse({ ...ROW, source_url: 'http://example.test/x' }).success,
    ).toBe(false);
  });

  it('field null passes', () => {
    expect(FieldReportExportRowSchema.safeParse({ ...ROW, field: null }).success).toBe(true);
  });

  it('refuses a report id that is not a uuid', () => {
    expect(FieldReportExportRowSchema.safeParse({ ...ROW, report_id: 'fixture' }).success).toBe(
      false,
    );
  });
});
