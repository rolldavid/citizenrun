import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { GOV_FINANCE, budgetFields, readBudgets } from './budgets.ts';
import type { GovFinanceSpec } from './budgets.ts';

const FIXTURE = join(import.meta.dirname, '..', '..', '__fixtures__', 's01', 'budgets');
const CHECKED_AT = '2026-11-26T12:00:00.000Z';
const SPEC: GovFinanceSpec = {
  url: 'https://www2.census.gov/programs-surveys/gov-finances/tables/2022/zz-gov-finance.csv',
  idColumn: 'PID6',
  totalColumn: 'TOTAL_EXPENDITURE',
  units: 'thousands',
};

const body = (text: string | Buffer) => Readable.from([Buffer.from(text)]);

describe('budgets', () => {
  it('no 2022 government-finance file qualifies, so the stage loads no budget', () => {
    expect(GOV_FINANCE).toBeNull();
  });

  it('a file without a PID6 column writes nothing', async () => {
    const result = await readBudgets(
      body('UNIT_ID,TOTAL_EXPENDITURE\n990001,1234\n'),
      SPEC,
      CHECKED_AT,
    );
    expect(result.reason).toBe('no PID6 column');
    expect(result.budgets.size).toBe(0);
    expect(budgetFields(result.budgets, '990001')).toEqual({
      budget_cents: null,
      budget_year: null,
      meta: null,
    });
  });

  it('a qualifying fixture file fills budget_cents in cents with its proof', async () => {
    const csv = await readFile(join(FIXTURE, 'zz-gov-finance.csv'));
    const result = await readBudgets(body(csv), SPEC, CHECKED_AT);
    expect(result.reason).toBeNull();
    // 1234 thousand dollars = 123,400,000 cents; 56.5 thousand dollars = 5,650,000 cents.
    expect(budgetFields(result.budgets, '990001')).toEqual({
      budget_cents: 123_400_000,
      budget_year: 2022,
      meta: {
        source_url: SPEC.url,
        quote: 'PID6 990001: TOTAL_EXPENDITURE 1234',
        confidence: 'medium',
        checked_at: CHECKED_AT,
      },
    });
    expect(budgetFields(result.budgets, '990002').budget_cents).toBe(5_650_000);
    const dollars = await readBudgets(body(csv), { ...SPEC, units: 'dollars' }, CHECKED_AT);
    expect(budgetFields(dollars.budgets, '990001').budget_cents).toBe(123_400);
  });

  it('a row whose id or total is not of its form is skipped and counted', async () => {
    const result = await readBudgets(
      body('PID6,TOTAL_EXPENDITURE\n99001,10\n990003,n/a\n990004,7\n'),
      SPEC,
      CHECKED_AT,
    );
    expect([...result.budgets.keys()]).toEqual(['990004']);
    expect(result.skipped).toBe(2);
  });
});
