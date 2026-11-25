import type { Db } from '../../client.ts';
import { appEvents } from '../../schema/partitioned.ts';
import type { AppEventRow, NewAppEventRow } from '../../schema/partitioned.ts';
import { defaultFactoryContext } from './context.ts';
import type { FactoryContext } from './context.ts';

/** The overrides of the AppEvent factory: any column but the identity `id`. */
export type AppEventOverrides = Omit<Partial<NewAppEventRow>, 'id'>;

/**
 * A logged-out `fixture_event` from the web with empty props, dated `ctx.now`. A row dated before
 * the month the template was built has no partition; a test that needs one creates it.
 */
export function makeAppEvent(
  overrides: AppEventOverrides = {},
  ctx: FactoryContext = defaultFactoryContext(),
): NewAppEventRow {
  return {
    name: 'fixture_event',
    platform: 'web',
    props: {},
    userId: null,
    createdAt: ctx.now,
    ...overrides,
  };
}

/** Writes makeAppEvent(overrides) and returns the stored row, with its identity `id`. */
export async function insertAppEvent(
  db: Db,
  overrides: AppEventOverrides = {},
  ctx: FactoryContext = defaultFactoryContext(),
): Promise<AppEventRow> {
  const [row] = await db.insert(appEvents).values(makeAppEvent(overrides, ctx)).returning();
  if (row === undefined) {
    throw new Error('The app_events insert returned no row.');
  }
  return row;
}
