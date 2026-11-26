import type { StateRules } from '../types.ts';

/** The state rules modules by two-letter code; a state with no module yet is absent. */
export const STATE_MODULES: ReadonlyMap<string, StateRules> = new Map<string, StateRules>();
