import { COVERED_STATES_CACHE_MS } from '@citizenrun/shared';
import { sql } from 'drizzle-orm';
import type { Deps } from '../../deps.ts';

/** The covered states of one `Deps`, read through a cache of COVERED_STATES_CACHE_MS. */
export type CoveredStatesReader = { get(now: Date): Promise<ReadonlySet<string>> };

type Loaded = { states: ReadonlySet<string>; loadedAt: number };

// One reader per Deps, like flagsOf (D-452: no Deps member).
const readers = new WeakMap<Deps, CoveredStatesReader>();

async function loadCoveredStates(deps: Deps): Promise<ReadonlySet<string>> {
  // index: offices_state_rank (the state prefix)
  const rows = await deps.db.execute<{ state: string }>(
    sql`select s.state from state_rules s
        where exists (select 1 from offices o where o.state = s.state and o.retired_at is null)`,
    'objects',
  );
  return new Set(rows.map((row) => row.state));
}

function createReader(deps: Deps): CoveredStatesReader {
  let loaded: Loaded | null = null;
  let pending: Promise<ReadonlySet<string>> | null = null;
  return {
    get(now: Date): Promise<ReadonlySet<string>> {
      const at = now.getTime();
      if (loaded !== null && at - loaded.loadedAt < COVERED_STATES_CACHE_MS) {
        return Promise.resolve(loaded.states);
      }
      if (pending !== null) {
        return pending;
      }
      // Callers during a reload share one load; a failed load rejects and keeps the old cache.
      const load = loadCoveredStates(deps).then(
        (states) => {
          loaded = { states, loadedAt: at };
          pending = null;
          return states;
        },
        (error: unknown) => {
          pending = null;
          throw error;
        },
      );
      pending = load;
      return load;
    },
  };
}

/**
 * The covered states: every state with a rules row and at least one live office,
 * cached per `Deps` until `now` is COVERED_STATES_CACHE_MS past the last load.
 */
export function coveredStatesOf(deps: Deps): CoveredStatesReader {
  let reader = readers.get(deps);
  if (reader === undefined) {
    reader = createReader(deps);
    readers.set(deps, reader);
  }
  return reader;
}
