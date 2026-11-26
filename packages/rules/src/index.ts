import { STATE_MODULES } from './states/index.ts';
import type { StateRules } from './types.ts';

/** The state's rules module, or null for a state with no module yet. */
export function rulesFor(state: string): StateRules | null {
  return STATE_MODULES.get(state) ?? null;
}

export { classifyTurnout, MAJORITY_PRIMARY_STATES } from './turnout.ts';
export type { ConcurrentTopOffice, TurnoutInput } from './turnout.ts';
export { evaluateFee, evaluateSignatures } from './evaluate.ts';
export * from './dates.ts';
export type * from './types.ts';
