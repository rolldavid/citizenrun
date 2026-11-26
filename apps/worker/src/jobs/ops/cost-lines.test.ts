import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_GB,
  COST_LINES,
  EMAIL_QUOTA_ALERT_SHARE,
  STORAGE_CENTS_PER_GB_MONTH,
  STORAGE_THRESHOLD_CENTS,
  UPLOAD_GROWTH_MONTHLY_MAX_BYTES,
  emailDayCostLine,
  emailDayLine,
  emailMonthCostLine,
  emailMonthLine,
  GEO_CAP_ALERT_SHARE,
  geocodingCostLine,
  geocodingDayCostLine,
  geocodingDayLine,
  geocodingLine,
  projectMonth,
  signinCeilingCostLine,
  signinCeilingLine,
  storageLine,
  storageProjectionCents,
  uploadGrowthCostLine,
  uploadGrowthLine,
} from './cost-lines.ts';

describe('the storage cost line', () => {
  it('storage just under and just over its threshold', () => {
    // 666,666,666,666 bytes at 1.5 cents per GB is 999.999999999 cents, rounded up to 1,000.
    expect(storageProjectionCents(666_666_666_666)).toBe(1_000);
    expect(storageProjectionCents(666_666_666_666) > STORAGE_THRESHOLD_CENTS).toBe(false);
    expect(storageProjectionCents(666_666_666_667)).toBe(1_001);
    expect(storageProjectionCents(666_666_666_667) > STORAGE_THRESHOLD_CENTS).toBe(true);
  });

  it('zero bytes project zero', () => {
    expect(storageProjectionCents(0)).toBe(0);
  });

  it('one byte projects one cent', () => {
    expect(storageProjectionCents(1)).toBe(1);
  });

  it('the integer formula charges the stated price', () => {
    expect(storageProjectionCents(2 * BYTES_PER_GB)).toBe(2 * STORAGE_CENTS_PER_GB_MONTH);
    expect(storageProjectionCents(100 * BYTES_PER_GB)).toBe(150);
    expect(STORAGE_THRESHOLD_CENTS).toBe(1_000);
  });
});

describe('the upload, email and sign-in cost lines', () => {
  it('projects a month from the days elapsed', async () => {
    await eachZone(() => {
      // April has 30 days: day 10 projects × 3. March has 31: its last day projects × 1.
      expect(projectMonth(100, new Date('2027-04-10T12:00:00Z'))).toBe(300);
      expect(projectMonth(100, new Date('2027-03-31T23:59:59Z'))).toBe(100);
      // The UTC day, not the process zone's: 00:30 UTC on the 1st is day 1 of 30.
      expect(projectMonth(100, new Date('2027-04-01T00:30:00Z'))).toBe(3_000);
      // February 2028 has 29 days.
      expect(projectMonth(29, new Date('2028-02-01T08:00:00Z'))).toBe(841);
    });
  });

  it('upload growth just under and over 100 GB a month', () => {
    expect(BYTES_PER_GB).toBe(1_000_000_000);
    expect(UPLOAD_GROWTH_MONTHLY_MAX_BYTES).toBe(100_000_000_000);
    // 3,333,333,333 × 30 = 99,999,999,990 bytes.
    expect(uploadGrowthLine(3_333_333_333)).toEqual({
      line: 'upload_growth',
      value: 3_333_333_333,
      projected: 99_999_999_990,
      threshold: 100_000_000_000,
      over: false,
    });
    // 3,333,333,334 × 30 = 100,000,000,020 bytes.
    expect(uploadGrowthLine(3_333_333_334)).toEqual({
      line: 'upload_growth',
      value: 3_333_333_334,
      projected: 100_000_000_020,
      threshold: 100_000_000_000,
      over: true,
    });
    expect(uploadGrowthLine(0).over).toBe(false);
  });

  it('email month at 80 percent', () => {
    // Quota 3000 on day 10 of a 30-day month: the threshold is 2400.
    const day10 = new Date('2027-04-10T09:50:00Z');
    expect(emailMonthLine(799, 3000, day10)).toEqual({
      line: 'email_month',
      value: 799,
      projected: 2397,
      threshold: 2400,
      over: false,
    });
    expect(emailMonthLine(800, 3000, day10)).toEqual({
      line: 'email_month',
      value: 800,
      projected: 2400,
      threshold: 2400,
      over: true,
    });
  });

  it('email month decides on the unrounded projection', () => {
    // 77 on day 3 of 31 projects 795.67, under 80% of 1000; 78 projects 806, over.
    const day3 = new Date('2027-03-03T09:50:00Z');
    expect(emailMonthLine(77, 1000, day3)).toMatchObject({ projected: 796, over: false });
    expect(emailMonthLine(78, 1000, day3)).toMatchObject({ projected: 806, over: true });
    // 490 on day 19 of 31 projects 799.47, over 799.2, though it reads 799 against 800 rounded.
    expect(emailMonthLine(490, 999, new Date('2027-03-19T09:50:00Z'))).toMatchObject({
      projected: 799,
      threshold: 800,
      over: true,
    });
    // 799 projected against 799.2: not over, though the rounded threshold reads 800.
    expect(emailMonthLine(799, 999, new Date('2027-04-30T09:50:00Z'))).toMatchObject({
      projected: 799,
      threshold: 800,
      over: false,
    });
  });

  it('email day at 80 percent', () => {
    expect(emailDayLine(79, 100)).toEqual({
      line: 'email_day',
      value: 79,
      projected: 79,
      threshold: 80,
      over: false,
    });
    expect(emailDayLine(80, 100)).toEqual({
      line: 'email_day',
      value: 80,
      projected: 80,
      threshold: 80,
      over: true,
    });
    expect(EMAIL_QUOTA_ALERT_SHARE).toBe(0.8);
  });

  it('email day is off at quota 0', () => {
    expect(emailDayLine(500, 0)).toEqual({
      line: 'email_day',
      value: 500,
      projected: 500,
      threshold: 0,
      over: false,
    });
  });

  it('sign-in ceiling at 1,000', () => {
    expect(signinCeilingLine(999)).toEqual({
      line: 'signin_ceiling',
      value: 999,
      projected: 999,
      threshold: 1000,
      over: false,
    });
    expect(signinCeilingLine(1000)).toEqual({
      line: 'signin_ceiling',
      value: 1000,
      projected: 1000,
      threshold: 1000,
      over: true,
    });
  });

  it('the job reads the seven lines in order', () => {
    expect(COST_LINES).toEqual([
      storageLine,
      uploadGrowthCostLine,
      emailMonthCostLine,
      emailDayCostLine,
      signinCeilingCostLine,
      geocodingCostLine,
      geocodingDayCostLine,
    ]);
    expect(COST_LINES.map((line) => line.line)).toEqual([
      'storage',
      'upload_growth',
      'email_month',
      'email_day',
      'signin_ceiling',
      'geocoding',
      'geocoding_day',
    ]);
  });
});

describe('the geocoding cost lines', () => {
  it('geocoding at 80 percent', () => {
    // Cap 85,000 on day 10 of a 30-day month: the threshold is 68,000 and the month projects x 3.
    const day10 = new Date('2027-04-10T09:50:00Z');
    expect(geocodingLine(22_666, 85_000, day10)).toEqual({
      line: 'geocoding',
      value: 22_666,
      projected: 67_998,
      threshold: 68_000,
      over: false,
    });
    expect(geocodingLine(22_667, 85_000, day10)).toEqual({
      line: 'geocoding',
      value: 22_667,
      projected: 68_001,
      threshold: 68_000,
      over: true,
    });
    expect(GEO_CAP_ALERT_SHARE).toBe(0.8);
  });

  it('geocoding day at 80 percent', () => {
    // Cap 2,800: the threshold is 2,240.
    expect(geocodingDayLine(2_239, 2_800)).toEqual({
      line: 'geocoding_day',
      value: 2_239,
      projected: 2_239,
      threshold: 2_240,
      over: false,
    });
    expect(geocodingDayLine(2_240, 2_800)).toEqual({
      line: 'geocoding_day',
      value: 2_240,
      projected: 2_240,
      threshold: 2_240,
      over: true,
    });
  });

  it('geocoding decides on the unrounded projection', () => {
    // A cap of 999: 80% is 799.2. 490 on day 19 of 31 projects 799.47, over though it reads 799.
    expect(geocodingLine(490, 999, new Date('2027-03-19T09:50:00Z'))).toMatchObject({
      projected: 799,
      threshold: 800,
      over: true,
    });
    // 799 a day under 799.2: not over, though the rounded threshold reads 800.
    expect(geocodingDayLine(799, 999)).toMatchObject({ threshold: 800, over: false });
  });
});
