import { describe, expect, it } from 'vitest';
import { eachZone } from '../testing/index.ts';
import { FIRST_DAY_HOURS, NEW_ACCOUNT_DAYS, isFirstDay, isNewAccount } from './account-age.ts';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const CREATED = new Date('2027-03-05T23:30:00.000Z');

function after(ms: number): Date {
  return new Date(CREATED.getTime() + ms);
}

describe('L-account-age', () => {
  it('new until seven days', async () => {
    expect(NEW_ACCOUNT_DAYS).toBe(7);
    const answers: boolean[][] = [];
    await eachZone(() => {
      const justUnder = after(6 * DAY_MS + 23 * HOUR_MS + 59 * MINUTE_MS + 59 * SECOND_MS + 999);
      const exactly = after(7 * 24 * HOUR_MS);
      answers.push([
        isNewAccount(CREATED, CREATED),
        isNewAccount(CREATED, justUnder),
        isNewAccount(CREATED, exactly),
        isNewAccount(CREATED, after(8 * DAY_MS)),
      ]);
    });
    expect(answers).toEqual([
      [true, true, false, false],
      [true, true, false, false],
    ]);
  });

  it('first day', async () => {
    expect(FIRST_DAY_HOURS).toBe(24);
    const answers: boolean[][] = [];
    await eachZone(() => {
      answers.push([
        isFirstDay(CREATED, CREATED),
        isFirstDay(CREATED, after(23 * HOUR_MS + 59 * MINUTE_MS)),
        isFirstDay(CREATED, after(24 * HOUR_MS)),
      ]);
    });
    expect(answers).toEqual([
      [true, true, false],
      [true, true, false],
    ]);
  });
});
