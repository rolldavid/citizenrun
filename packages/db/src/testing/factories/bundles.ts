import { newId } from '@citizenrun/shared';
import type { Db, Tx } from '../../client.ts';
import { bundleChanges, dataBundles } from '../../schema/bundles.ts';
import type {
  BundleChangeRow,
  DataBundleRow,
  NewBundleChangeRow,
  NewDataBundleRow,
} from '../../schema/bundles.ts';
import { nextSequence } from '../sequence.ts';
import { SECOND_MS, defaultFactoryContext, shiftMs } from './context.ts';
import type { FactoryContext } from './context.ts';

// The bundle factories (TEST-harness-factories).

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * A loaded `full` bundle with no stats, loaded at `ctx.now`. Its version is the UTC date of
 * `ctx.now`, then `T` and the UTC time of `ctx.now` plus `<seq>` seconds, then `Z-full`, so two
 * bundles of one test never share a version.
 */
export function makeDataBundle(
  overrides: Partial<NewDataBundleRow> = {},
  ctx: FactoryContext = defaultFactoryContext(),
): NewDataBundleRow {
  const seq = nextSequence();
  const at = shiftMs(ctx.now, seq * SECOND_MS);
  const date =
    String(ctx.now.getUTCFullYear()).padStart(4, '0') +
    pad(ctx.now.getUTCMonth() + 1) +
    pad(ctx.now.getUTCDate());
  const time = pad(at.getUTCHours()) + pad(at.getUTCMinutes()) + pad(at.getUTCSeconds());
  return {
    id: newId(),
    version: `${date}T${time}Z-full`,
    kind: 'full',
    status: 'loaded',
    stats: null,
    loadedAt: ctx.now,
    ...overrides,
  };
}

/** Writes makeDataBundle(overrides) and returns the stored row. */
export async function insertDataBundle(
  db: Db | Tx,
  overrides: Partial<NewDataBundleRow> = {},
  ctx: FactoryContext = defaultFactoryContext(),
): Promise<DataBundleRow> {
  const [row] = await db.insert(dataBundles).values(makeDataBundle(overrides, ctx)).returning();
  if (row === undefined) {
    throw new Error('The data_bundles insert returned no row.');
  }
  return row;
}

/** The overrides of the BundleChange factory: any column, and the changed office's id. */
export type BundleChangeOverrides = Partial<NewBundleChangeRow> & { officeId?: string };

/**
 * A recorded update of an `offices` row: `row_key` `{ id }` with the given office id or a new id,
 * and an empty `before`. Without a `bundleId` the row names a new id; insertBundleChange then
 * creates the bundle.
 */
export function makeBundleChange(overrides: BundleChangeOverrides = {}): NewBundleChangeRow {
  const { officeId, ...columns } = overrides;
  return {
    bundleId: newId(),
    tableName: 'offices',
    rowKey: { id: officeId ?? newId() },
    op: 'update',
    before: {},
    ...columns,
  };
}

/** Writes makeBundleChange, creating its bundle when none is given; returns the stored row. */
export async function insertBundleChange(
  db: Db | Tx,
  overrides: BundleChangeOverrides = {},
  ctx: FactoryContext = defaultFactoryContext(),
): Promise<BundleChangeRow> {
  return db.transaction(async (tx) => {
    const bundleId = overrides.bundleId ?? (await insertDataBundle(tx, {}, ctx)).id;
    const [row] = await tx
      .insert(bundleChanges)
      .values(makeBundleChange({ ...overrides, bundleId }))
      .returning();
    if (row === undefined) {
      throw new Error('The bundle_changes insert returned no row.');
    }
    return row;
  });
}
