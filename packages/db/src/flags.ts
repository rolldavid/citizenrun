import { sql } from 'drizzle-orm';
import type { Db } from './client.ts';

export const FLAG_CACHE_MS = 30_000; // the one server flag helper caches 30 seconds

export type StateSignup = 'allow' | 'withhold';
export type StateAgeMethod = 'store_signal_or_dob' | 'store_signal_required';
export type StateRule = {
  state: string;
  signup: StateSignup;
  ageMethod: StateAgeMethod;
  candidateTools: boolean;
};

export type FlagReader = {
  /** The rules row of a state code, or null when the table has no row for it. */
  stateRule(state: string): Promise<StateRule | null>;
  /** True while every state_rules row has signup 'allow' and age_method 'store_signal_or_dob' (candidate_tools plays no part, CTL-76). */
  stateRulesAtLaunchDefault(): Promise<boolean>;
};

type StateRuleDbRow = {
  state: string;
  signup: StateSignup;
  age_method: StateAgeMethod;
  candidate_tools: boolean;
};

type Loaded = { rules: ReadonlyMap<string, StateRule>; loadedAt: Date };

/**
 * The one server reader of flags and per-state rules: each table is read whole and kept for
 * FLAG_CACHE_MS, timed by `clock`. Concurrent readers during a reload share one query; a failed
 * load rejects every waiting caller and keeps the previous rules, so the next call retries.
 */
export function createFlagReader(db: Db, clock: { now(): Date }): FlagReader {
  let loaded: Loaded | null = null;
  let inFlight: Promise<Loaded> | null = null;

  const load = async (): Promise<Loaded> => {
    const loadedAt = clock.now();
    // The whole table, at most 57 rows: a full read is the plan, no index is needed.
    const rows = await db.execute<StateRuleDbRow>(
      sql`select state, signup, age_method, candidate_tools from state_rules`,
      'objects',
    );
    const rules = new Map<string, StateRule>();
    for (const row of rows) {
      rules.set(row.state, {
        state: row.state,
        signup: row.signup,
        ageMethod: row.age_method,
        candidateTools: row.candidate_tools,
      });
    }
    return { rules, loadedAt };
  };

  const current = (): Promise<Loaded> => {
    if (loaded !== null && clock.now().getTime() - loaded.loadedAt.getTime() < FLAG_CACHE_MS) {
      return Promise.resolve(loaded);
    }
    if (inFlight === null) {
      inFlight = load().then(
        (result) => {
          loaded = result;
          inFlight = null;
          return result;
        },
        (error: unknown) => {
          inFlight = null;
          throw error;
        },
      );
    }
    return inFlight;
  };

  return {
    stateRule: async (state) => (await current()).rules.get(state) ?? null,
    stateRulesAtLaunchDefault: async () => {
      for (const rule of (await current()).rules.values()) {
        if (rule.signup !== 'allow' || rule.ageMethod !== 'store_signal_or_dob') {
          return false;
        }
      }
      return true;
    },
  };
}
