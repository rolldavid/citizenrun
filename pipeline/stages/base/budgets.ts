// Unit budgets (PIPE-budgets, P8-14): loaded only from a government-finance file with one
// column of each unit's total expenditure and one of a unit id equal to the listing's PID6.
import type { Readable } from 'node:stream';
import type { FieldMetaRow } from '@citizenrun/shared';
import { readDelimited } from '../../lib/csv.ts';

export const GOV_FINANCE_DATASET = 'gov-finance';
export const GOV_FINANCE_YEAR = 2022;

/** A qualifying unit file: where it is, its two columns and the unit its totals are written in. */
export type GovFinanceSpec = {
  readonly url: string;
  readonly idColumn: string;
  readonly totalColumn: string;
  readonly units: 'dollars' | 'thousands';
};

/**
 * The result of the check of the 2022 Census of Governments finance files (data/sources.yaml,
 * entry `gov-finance`): the individual unit file is in item-code form, one row per unit and
 * finance item with no total, so no file qualifies and every `budget_cents` stays null.
 */
export const GOV_FINANCE: GovFinanceSpec | null = null;

export type Budget = { readonly cents: number; readonly meta: FieldMetaRow };

const PID6 = /^\d{6}$/;
const AMOUNT = /^\d+(\.\d+)?$/;

/**
 * Reads a qualifying file's budgets by PID6. A file that lacks either column gives no budget and
 * the reason; a row whose id or total is not of its form is skipped and counted.
 */
export async function readBudgets(
  body: Readable,
  spec: GovFinanceSpec,
  checkedAt: string,
): Promise<{ budgets: Map<string, Budget>; reason: string | null; skipped: number }> {
  const budgets = new Map<string, Budget>();
  let idIndex = -1;
  let totalIndex = -1;
  let headed = false;
  let skipped = 0;
  const scale = spec.units === 'thousands' ? 1000 : 1;
  for await (const { record } of readDelimited(body, {
    delimiter: ',',
    header: true,
    encoding: 'utf8',
  })) {
    if (!headed) {
      headed = true;
      idIndex = record.indexOf(spec.idColumn);
      totalIndex = record.indexOf(spec.totalColumn);
      if (idIndex === -1) {
        return { budgets, reason: `no ${spec.idColumn} column`, skipped };
      }
      if (totalIndex === -1) {
        return { budgets, reason: `no ${spec.totalColumn} column`, skipped };
      }
      continue;
    }
    const id = (record[idIndex] ?? '').trim();
    const written = (record[totalIndex] ?? '').trim();
    const amount = written.replaceAll(',', '');
    const cents = Math.round(Number(amount) * scale * 100);
    if (!PID6.test(id) || !AMOUNT.test(amount) || !Number.isSafeInteger(cents)) {
      skipped += 1;
      continue;
    }
    budgets.set(id, {
      cents,
      meta: {
        source_url: spec.url,
        quote: `PID6 ${id}: ${spec.totalColumn} ${written}`,
        confidence: 'medium',
        checked_at: checkedAt,
      },
    });
  }
  return { budgets, reason: headed ? null : 'an empty file', skipped };
}

/** The budget fields of a unit's row: the file's total in cents and the census year, or null. */
export function budgetFields(
  budgets: ReadonlyMap<string, Budget>,
  pid6: string,
): { budget_cents: number | null; budget_year: number | null; meta: FieldMetaRow | null } {
  const found = budgets.get(pid6);
  return found === undefined
    ? { budget_cents: null, budget_year: null, meta: null }
    : { budget_cents: found.cents, budget_year: GOV_FINANCE_YEAR, meta: found.meta };
}
