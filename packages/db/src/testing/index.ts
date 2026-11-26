import type { HarnessContext } from './global-setup.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** The run's template database, run id and stamp, from the harness's global setup. */
    harness: HarnessContext;
  }
}

export { getTestDb, getTestDatabaseUrl, createTestBoss } from './worker.ts';
export { resetDb } from './setup.ts';
export {
  getTestBucket,
  resetStorage,
  putTestObject,
  getTestObject,
  listTestKeys,
} from './storage.ts';
export { readTestObject, testDataBucketClient, testMediaStore } from './bundle-io.ts';
export { ringWkbHex, sha256Hex, squareWkbHex } from './wkb.ts';
export {
  fixtureEnqueue,
  fixtureJobs,
  fixturePhotoRecord,
  fixtureVersion,
  loadFixture,
  snapshotCivic,
  writeFixtureBundle,
  zzBundle,
  zzGeometry,
  zzPhotoJpeg,
} from './bundle-fixtures.ts';
export type {
  FixtureAsset,
  FixtureBundleInput,
  FixtureRows,
  LoadFixtureOptions,
} from './bundle-fixtures.ts';
export { GATE_FAULTS, HOLD_FAULTS } from './bundle-faults.ts';
export type { GateFault, HoldFault } from './bundle-faults.ts';
export { fetchPresignedGet } from './presigned-get.ts';
export { buildPolicyForm, uploadWithPolicy } from './upload-with-policy.ts';
export { seedUsersStep } from '../seed/steps/010-users.ts';
export { SEED_USER_IDS } from '../seed/ids.ts';
export { captureLogs } from './logs.ts';
export type { CapturedLine } from './logs.ts';
export { idAt, uuidFloorAt } from './ids.ts';
export { registerScanValue, registerScanSource, scanForLeaks, PrivacyLeakError } from './scan.ts';
export { KEEP_TABLES } from './keep-tables.ts';
export * from './factories/index.ts';
export type { BucketKind } from './names.ts';
