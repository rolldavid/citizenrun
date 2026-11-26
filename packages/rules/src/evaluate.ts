// The fee and signature evaluators of PIPE-rules-api.
import { assertNever, roundHalfAwayFromZero } from '@citizenrun/shared';
import type { FeeRule, OfficeRef, SignatureInputs, SignatureRule } from './types.ts';

/** The filing fee in cents, or null when the rule needs a value that is not known. */
export function evaluateFee(rule: FeeRule, office: OfficeRef): number | null {
  switch (rule.kind) {
    case 'fixed':
      return rule.cents;
    case 'percent_of_annual_pay':
      return office.payAnnualCents === null
        ? null
        : roundHalfAwayFromZero((rule.percent * office.payAnnualCents) / 100);
    case 'none':
      // A real zero: the statute asks for no fee.
      return 0;
    default:
      return assertNever(rule);
  }
}

/**
 * The number of signatures a candidate must reach, or null. The two percent rules give null at
 * launch: registered-voter counts are not loaded and results history is partial.
 */
export function evaluateSignatures(rule: SignatureRule, inputs: SignatureInputs): number | null;
// No signature rule reads its inputs at launch.
export function evaluateSignatures(rule: SignatureRule): number | null {
  switch (rule.kind) {
    case 'fixed':
      return rule.count;
    case 'range':
      return rule.min;
    case 'percent_of_registered':
    case 'percent_of_votes':
      return null;
    case 'none':
      return 0;
    default:
      return assertNever(rule);
  }
}
