import type { StateRules } from '../types.ts';
import { laRules } from './la.ts';
import { ncRules } from './nc.ts';
import { txRules } from './tx.ts';
import { vaRules } from './va.ts';
import { waRules } from './wa.ts';

/** The state rules modules by two-letter code; a state with no module yet is absent. */
export const STATE_MODULES: ReadonlyMap<string, StateRules> = new Map<string, StateRules>([
  ['LA', laRules],
  ['NC', ncRules],
  ['TX', txRules],
  ['VA', vaRules],
  ['WA', waRules],
]);
