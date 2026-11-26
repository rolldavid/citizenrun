import { createFlagReader, waitForDatabase, withEmailCounters } from '@citizenrun/db';
import type { Db, Enqueue, FlagReader } from '@citizenrun/db';
import { BRAND, brandVariant, createI18n, variantForAppEnv } from '@citizenrun/shared';
import type { Clock, Logger, Mailer } from '@citizenrun/shared';
import { loadKeyRing } from '@citizenrun/shared/crypto';
import type { KeyRing } from '@citizenrun/shared/crypto';
import type { BucketHandle } from '@citizenrun/shared/storage';
import { createRemoteJWKSet, customFetch } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { ApiEnv } from './env.ts';
import { createApiDb, createApiPool } from './lib/db.ts';
import { createLifecycle } from './lib/lifecycle.ts';
import type { Lifecycle } from './lib/lifecycle.ts';
import { createMailer, isCaptureMailer } from './lib/mailer.ts';
import type { CapturedMailbox } from './lib/mailer.ts';
import { createOutboundFetch } from './lib/outbound-fetch.ts';
import type { OutboundFetch } from './lib/outbound-fetch.ts';
import { createApiQueue } from './lib/queue.ts';
import { createMediaBucket } from './lib/storage.ts';
import { prepareLegalDocuments } from './web/documents/load.ts';
import type { LegalDocumentPages } from './web/documents/load.ts';

export type { Clock } from '@citizenrun/shared';

/** The service's clock: the only `new Date()` without an argument in the API. */
export const systemClock: Clock = { now: () => new Date() };

/** What the API's routes, middleware and services take from outside (D-452). */
export type Deps = {
  env: ApiEnv;
  db: Db;
  queue: { enqueue: Enqueue };
  storage: { media: BucketHandle };
  mailer: Mailer;
  clock: Clock;
  logger: Logger;
  lifecycle: Lifecycle;
  keyRing: KeyRing;
  outbound: OutboundFetch;
  identityKeys: IdentityKeys;
  /** The three legal pages, rendered before the server listens (L-legal-docs). */
  documents: LegalDocumentPages;
};

/** The two sign-in providers' signing key sets (D-452). */
export type IdentityKeys = { readonly apple: JWTVerifyGetKey; readonly google: JWTVerifyGetKey };

// L-apple, L-google: the providers' published key sets, fetched within 5 seconds (CTL-37).
const APPLE_KEYS_URL = 'https://appleid.apple.com/auth/keys';
const GOOGLE_KEYS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const IDENTITY_KEYS_TIMEOUT_MS = 5000;

/**
 * Apple's and Google's remote key sets, each downloading through `outbound` (D-452). Nothing is
 * fetched until the first verification, so building them opens no connection.
 */
export function createIdentityKeys(outbound: OutboundFetch): IdentityKeys {
  const options = {
    timeoutDuration: IDENTITY_KEYS_TIMEOUT_MS,
    [customFetch]: (url: string, init: RequestInit): Promise<Response> => {
      const target = new URL(url);
      return outbound(target.host, target.pathname + target.search, init);
    },
  };
  return {
    apple: createRemoteJWKSet(new URL(APPLE_KEYS_URL), options),
    google: createRemoteJWKSet(new URL(GOOGLE_KEYS_URL), options),
  };
}

/** The one way services get the job sender: `deps.queue.enqueue`. */
export function enqueueOf(deps: Deps): Enqueue {
  return deps.queue.enqueue;
}

// One flag reader per Deps, so one app has one cache and two apps never share one. A WeakMap holds
// no connection and starts no timer.
const flagReaders = new WeakMap<Deps, FlagReader>();

/** The flag reader of `deps`, made on first use and kept for the life of `deps`. */
export function flagsOf(deps: Deps): FlagReader {
  let reader = flagReaders.get(deps);
  if (reader === undefined) {
    reader = createFlagReader(deps.db, deps.clock);
    flagReaders.set(deps, reader);
  }
  return reader;
}

/** withEmailCounters over `inner` (L-send-email); when `inner` is a capture mailer the result keeps its captured() (E-AUTH-11). */
export function countedMailer(inner: Mailer, db: Db, clock: { now(): Date }, log: Logger): Mailer {
  const counted = withEmailCounters(inner, db, clock, log);
  if (!isCaptureMailer(inner)) return counted;
  const kept: Mailer & CapturedMailbox = {
    sendEmail: (message) => counted.sendEmail(message),
    captured: () => inner.captured(),
  };
  return kept;
}

/** The dependencies of a running service, with the one call that releases them. */
export type ApiRuntime = Deps & { close(): Promise<void> };

/**
 * The legal pages of a running service from the documents folder its entry file computed, with the
 * variant's display name, `PUBLIC_URL`, the brand's contacts and the English catalog (L-legal-docs).
 * Throws DocumentError when a document is missing or invalid.
 */
export function loadServiceDocuments(
  env: ApiEnv,
  logger: Logger,
  documentsDir: string,
): LegalDocumentPages {
  return prepareLegalDocuments({
    dir: documentsDir,
    appName: brandVariant(variantForAppEnv(env.APP_ENV)).displayName,
    publicUrl: env.PUBLIC_URL,
    contacts: BRAND.contacts,
    t: createI18n({ lng: 'en' }).getFixedT('en'),
    appEnv: env.APP_ENV,
    logger,
  });
}

/**
 * Builds the running service's dependencies from its environment: the legal pages from
 * `documentsDir` (read first, so an invalid document stops the start before any connection), the
 * pool and database, the send-only queue, the media bucket, the counted mailer, the clock, the
 * given logger, the drain state, the key ring, the outbound fetch and the sign-in key sets.
 * Waits for the database before the queue starts (D-140), for `databaseWaitMs` or the helper's own
 * window; when it gives up, the pool is ended and DatabaseUnavailableError is rethrown.
 * `close()` stops the queue, then ends the pool.
 */
export async function createDeps(
  env: ApiEnv,
  logger: Logger,
  options: { documentsDir: string; databaseWaitMs?: number },
): Promise<ApiRuntime> {
  const documents = loadServiceDocuments(env, logger, options.documentsDir);
  const pool = createApiPool(env);
  const db = createApiDb(pool);
  let queue: Awaited<ReturnType<typeof createApiQueue>>;
  try {
    await waitForDatabase(
      pool,
      options.databaseWaitMs === undefined ? {} : { timeoutMs: options.databaseWaitMs },
    );
    queue = await createApiQueue(env, logger);
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }
  const outbound = createOutboundFetch(env);
  return {
    env,
    db,
    queue: { enqueue: queue.enqueue },
    storage: { media: createMediaBucket(env) },
    mailer: countedMailer(createMailer(env, logger), db, systemClock, logger),
    clock: systemClock,
    logger,
    lifecycle: createLifecycle(),
    keyRing: loadKeyRing(env.APP_SECRET, env.APP_SECRET_PREVIOUS ?? null),
    outbound,
    identityKeys: createIdentityKeys(outbound),
    documents,
    close: async () => {
      await queue.stop();
      await pool.end();
    },
  };
}
