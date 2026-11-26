export { createDb, createPool, DatabaseUnavailableError, waitForDatabase } from './client.ts';
export type { Db, Tx } from './client.ts';
export { MigrationConnectError, runMigrations } from './migrator.ts';
export { createEnqueue, QueueMissingError } from './queue/enqueue.ts';
export type { Enqueue, EnqueueOptions } from './queue/enqueue.ts';
export { bytea, citext, geometry, tsvector } from './types.ts';
export {
  addUsage,
  countEmailSent,
  dayPeriod,
  monthPeriod,
  withEmailCounters,
} from './usage-counters.ts';
export type { UsageCounterName } from './usage-counters.ts';
export { FLAG_CACHE_MS, createFlagReader } from './flags.ts';
export type { FlagReader, StateAgeMethod, StateRule, StateSignup } from './flags.ts';
export {
  AUTOMATIC_ADMIN_ID,
  insertAdminAction,
  recordSystemAdminAction,
  type AdminActionTarget,
} from './admin-actions.ts';
export { markAccountDeleting } from './accounts/index.ts';
export type { MarkDeletingResult } from './accounts/index.ts';
export * from './schema/index.ts';
export * from './schema/partitioned.ts';
export {
  activeDistricts,
  activeElections,
  activeJurisdictions,
  activeOffices,
  activePeople,
} from './sql/civic.ts';
export { refreshOfficeSearch } from './sql/office-search.ts';
export { recomputeHeadlineDeadlines } from './sql/headline-deadline.ts';
export { lookupDistrictsAtPoint } from './sql/point-lookup.ts';
export type { DistrictLevel, GeometryQuality, PointDistrictRow } from './sql/point-lookup.ts';
export {
  DISPLAY_BAND_FULL,
  SUBDIVIDE_MAX_VERTICES,
  insertDisplayBandFullSql,
  insertDistrictPartsSql,
} from './sql/district-geometry.ts';
export {
  BundleStatsSchema,
  GateResultSchema,
  type BundleStats,
  type GateResult,
} from './bundle/stats.ts';
