import { newId } from '@citizenrun/shared';
import type { PgBoss } from 'pg-boss';
import { describe, expect, it } from 'vitest';
import { createTestBoss, getTestDb } from '../testing/index.ts';
import { QueueMissingError, createEnqueue } from './enqueue.ts';

class RollBack extends Error {
  override readonly name = 'RollBack';
}

async function jobsIn(boss: PgBoss, name: string): Promise<number> {
  return (await boss.findJobs(name)).length;
}

describe('createEnqueue', () => {
  it('sends a parsed payload and returns its id', async () => {
    const boss = await createTestBoss();
    const enqueue = createEnqueue(boss);
    const values = { queue: 'cost.check', jobId: newId(), errorClass: 'TypeError' };
    const id = await enqueue('ops.alert', { kind: 'job_failed', values });
    expect(typeof id).toBe('string');
    const [job] = await boss.findJobs('ops.alert', { id: id ?? '' });
    expect(job?.data).toEqual({ kind: 'job_failed', values });
  });

  it('refuses a payload that fails its schema', async () => {
    const boss = await createTestBoss();
    const enqueue = createEnqueue(boss);
    await expect(
      enqueue('ops.heartbeat', { extra: 1 } as never), // the test sends an invalid payload
    ).rejects.toThrow();
    expect(await jobsIn(boss, 'ops.heartbeat')).toBe(0);
  });

  it('a send in a rolled-back transaction leaves no job', async () => {
    const boss = await createTestBoss();
    const enqueue = createEnqueue(boss);
    let sent: string | null = null;
    await expect(
      getTestDb().transaction(async (tx) => {
        sent = await enqueue('cost.check', {}, { tx });
        throw new RollBack('roll back');
      }),
    ).rejects.toBeInstanceOf(RollBack);
    expect(typeof sent).toBe('string');
    expect(await jobsIn(boss, 'cost.check')).toBe(0);
  });

  it('a send in a committed transaction leaves one job', async () => {
    const boss = await createTestBoss();
    const enqueue = createEnqueue(boss);
    const id = await getTestDb().transaction(async (tx) => enqueue('cost.check', {}, { tx }));
    const jobs = await boss.findJobs('cost.check');
    expect(jobs.map((job) => job.id)).toEqual([id]);
  });

  it('a throttled send inside its window returns null', async () => {
    const boss = await createTestBoss();
    const enqueue = createEnqueue(boss);
    const payload = { kind: 'job_failed' as const, values: { queue: 'x' } };
    const throttle = { seconds: 3600, key: 'job_failed:x' };
    const first = await enqueue('ops.alert', payload, { throttle });
    const second = await enqueue('ops.alert', payload, { throttle });
    expect(typeof first).toBe('string');
    expect(second).toBeNull();
    expect(await jobsIn(boss, 'ops.alert')).toBe(1);
  });

  it('a debounced send inside its window returns null for the third send', async () => {
    const boss = await createTestBoss();
    const enqueue = createEnqueue(boss);
    const debounce = { seconds: 3600, key: 'heartbeat' };
    const ids = [
      await enqueue('ops.heartbeat', {}, { debounce }),
      await enqueue('ops.heartbeat', {}, { debounce }),
      await enqueue('ops.heartbeat', {}, { debounce }),
    ];
    expect(ids.filter((id) => id !== null).length).toBeLessThan(3);
    expect(ids[2]).toBeNull();
  });

  it('passes the singleton key to the job', async () => {
    const boss = await createTestBoss();
    const enqueue = createEnqueue(boss);
    const id = await enqueue('backup.check', {}, { singletonKey: 'daily' });
    const [job] = await boss.findJobs('backup.check', { id: id ?? '' });
    expect(job?.singletonKey).toBe('daily');
  });

  it('startAfter delays the job', async () => {
    const boss = await createTestBoss();
    const enqueue = createEnqueue(boss);
    const id = await enqueue('db.connections-check', {}, { startAfter: 60 });
    const [job] = await boss.findJobs('db.connections-check', { id: id ?? '' });
    expect(job).toBeDefined();
    const delayMs = (job?.startAfter.getTime() ?? 0) - (job?.createdOn.getTime() ?? 0);
    expect(delayMs).toBeGreaterThanOrEqual(59_000);
  });

  it('debounce and throttle together are refused', async () => {
    const boss = await createTestBoss();
    const enqueue = createEnqueue(boss);
    const window = { seconds: 60, key: 'k' };
    const sending = enqueue('cost.check', {}, { debounce: window, throttle: window });
    await expect(sending).rejects.toBeInstanceOf(TypeError);
    await expect(sending).rejects.toThrow('debounce and throttle are exclusive');
    expect(await jobsIn(boss, 'cost.check')).toBe(0);
  });

  it('a send to a missing queue throws QueueMissingError', async () => {
    const boss = await createTestBoss();
    const enqueue = createEnqueue(boss);
    await boss.deleteQueue('cost.check');
    const error: unknown = await enqueue('cost.check', {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(QueueMissingError);
    expect(error).toMatchObject({
      name: 'QueueMissingError',
      queue: 'cost.check',
      message: 'queue missing',
    });
  });

  it('createTestBoss brings back a queue a test deleted', async () => {
    const first = await createTestBoss();
    await first.deleteQueue('cost.check');
    expect(await first.getQueue('cost.check')).toBeNull();
    const second = await createTestBoss();
    expect(await second.getQueue('cost.check')).not.toBeNull();
    expect(typeof (await createEnqueue(second)('cost.check', {}))).toBe('string');
  });
});
