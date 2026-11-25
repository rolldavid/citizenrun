import { getTestObject, resetStorage } from '@citizenrun/db/testing';
import { keyedHash, loadKeyRing } from '@citizenrun/shared/crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { JobContext } from '../context.ts';
import type { JobDefinition } from '../jobs/types.ts';
import { putObject } from '../lib/bucket-ops.ts';
import { QUEUE_OPTIONS } from '../queue-options.ts';
import { UnexpectedOutboundCall, createFakeOutbound } from './fakes/outbound.ts';
import { runJob } from './job.ts';

const FIXTURE_USER_ID = '0195d2c4-0000-7000-8000-00000000f001';
const FIXTURE_JOB_ID = '0195d2c4-0000-7000-8000-00000000f002';
const TEST_APP_SECRET = '0123456789abcdef'.repeat(4);

// A definition that is never registered: it only keeps the context it was given.
function probe(): { definition: JobDefinition<'cost.check'>; seen: JobContext[] } {
  const seen: JobContext[] = [];
  return {
    seen,
    definition: {
      name: 'cost.check',
      queue: QUEUE_OPTIONS['cost.check'].queue,
      work: { localConcurrency: 1, pollingIntervalSeconds: 10 },
      handle: (_payload, ctx) => {
        seen.push(ctx);
        return Promise.resolve();
      },
    },
  };
}

function only(seen: readonly JobContext[]): JobContext {
  expect(seen).toHaveLength(1);
  const [ctx] = seen;
  if (ctx === undefined) {
    throw new Error('The probe saw no context.');
  }
  return ctx;
}

beforeEach(async () => {
  await resetStorage();
});

describe('the job context', () => {
  it('gives a job the media bucket, the key ring and a closed outbound', async () => {
    const { definition, seen } = probe();
    const result = await runJob(definition, {});
    expect(result.outcome).toBe('completed');
    const ctx = only(seen);

    const bytes = new Uint8Array([0xf1, 0x02, 0x03, 0x04]);
    await putObject(ctx.storage.media, 't/probe', bytes, {
      contentType: 'application/octet-stream',
    });
    expect(await getTestObject('media', 't/probe')).toEqual(bytes);
    expect(await getTestObject('backups', 't/probe')).toBeNull();

    expect(keyedHash(ctx.keys, { kind: 'user', userId: FIXTURE_USER_ID })).toBe(
      keyedHash(loadKeyRing(TEST_APP_SECRET, null), { kind: 'user', userId: FIXTURE_USER_ID }),
    );

    await expect(
      ctx.outbound('appleid.apple.com', '/auth/revoke', { method: 'POST' }),
    ).rejects.toBeInstanceOf(UnexpectedOutboundCall);

    expect(ctx.env.APPLE_TEAM_ID).toBeNull();
    expect(ctx.env.APPLE_KEY_ID).toBeNull();
    expect(ctx.env.APPLE_PRIVATE_KEY).toBeNull();
    expect(ctx.env.MEDIA_BUCKET).toBe(ctx.storage.media.bucket);
    expect(ctx.job.isFinalAttempt).toBe(false);
  });

  it('overrides replace each default', async () => {
    const fake = createFakeOutbound();
    fake.on('appleid.apple.com', 'POST', '/auth/revoke', () => ({ status: 200 }));
    const createdOn = new Date('2027-03-05T12:00:00.000Z');
    const { definition, seen } = probe();
    await runJob(
      definition,
      {},
      {
        env: { EMAIL_DAILY_QUOTA: 0 },
        job: { id: FIXTURE_JOB_ID, retryCount: 2, createdOn },
        outbound: fake.fetch,
      },
    );
    const ctx = only(seen);
    expect(ctx.env.EMAIL_DAILY_QUOTA).toBe(0);
    expect(ctx.job.id).toBe(FIXTURE_JOB_ID);
    expect(ctx.job.createdOn).toEqual(createdOn);
    expect(ctx.job.retryCount).toBe(2);
    expect(ctx.job.isFinalAttempt).toBe(true);
    const response = await ctx.outbound('appleid.apple.com', '/auth/revoke', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      host: 'appleid.apple.com',
      method: 'POST',
      path: '/auth/revoke',
    });

    const first = probe();
    await runJob(first.definition, {}, { job: { retryCount: 0 } });
    expect(only(first.seen).job.isFinalAttempt).toBe(false);
  });

  it('a raw variable is read as the worker reads it and a parsed value replaces its own', async () => {
    const { definition, seen } = probe();
    const otherKeys = loadKeyRing('fedcba9876543210'.repeat(4), null);
    await runJob(
      definition,
      {},
      { env: { APP_ENV: 'local', ADMIN_EMAILS: 'second@example.test' }, keys: otherKeys },
    );
    const ctx = only(seen);
    expect(ctx.env.APP_ENV).toBe('local');
    expect(ctx.env.envLabel).toBe('local');
    expect(ctx.env.ADMIN_EMAILS).toEqual(['second@example.test']);
    expect(ctx.keys).toBe(otherKeys);
  });
});
