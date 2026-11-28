import { eachZone } from '@citizenrun/shared/testing';
import { describe, expect, it } from 'vitest';
import * as entry from './index.ts';
import { STATE_MODULES } from './states/index.ts';

describe('@citizenrun/rules', () => {
  it('the five pilot states have modules', async () => {
    await eachZone(() => {
      for (const state of ['LA', 'NC', 'TX', 'VA', 'WA']) {
        const rules = entry.rulesFor(state);
        expect(rules).not.toBeNull();
        expect(rules?.state).toBe(state);
        expect(STATE_MODULES.get(state)).toBe(rules);
      }
      expect(entry.rulesFor('ZZ')).toBeNull();
      expect(entry.rulesFor('CA')).toBeNull();
      expect(STATE_MODULES.size).toBe(5);
    });
  });

  it('the entry exports the interface', async () => {
    await eachZone(() => {
      for (const fn of [
        entry.rulesFor,
        entry.classifyTurnout,
        entry.evaluateFee,
        entry.evaluateSignatures,
        entry.novemberElectionDay,
        entry.federalHolidays,
        entry.roll,
        entry.selectVersion,
        entry.toDayNumber,
        entry.fromDayNumber,
        entry.addDays,
        entry.daysBefore,
        entry.weekdayOf,
        entry.nthWeekdayOfMonth,
        entry.firstWeekdayOnOrAfter,
        entry.firstWeekdayAfter,
        entry.isBusinessDay,
      ]) {
        expect(typeof fn).toBe('function');
      }
      expect(entry.MAJORITY_PRIMARY_STATES).toBeInstanceOf(Set);
      expect([
        entry.SUNDAY,
        entry.MONDAY,
        entry.TUESDAY,
        entry.WEDNESDAY,
        entry.THURSDAY,
        entry.FRIDAY,
        entry.SATURDAY,
      ]).toEqual([0, 1, 2, 3, 4, 5, 6]);
    });
  });

  it('the entry exports nothing from the test helpers', async () => {
    await eachZone(() => {
      const names = Object.keys(entry);
      for (const testOnly of ['runStateRulesSuite', 'fixtureOffice', 'zzRules', 'STATE_MODULES']) {
        expect(names).not.toContain(testOnly);
      }
    });
  });
});
