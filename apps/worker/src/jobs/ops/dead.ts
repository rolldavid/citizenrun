import { QUEUE_OPTIONS } from '../../queue-options.ts';
import type { JobDefinition } from '../types.ts';

/** One alert email per source queue in this window (D-238). */
export const JOB_FAILED_THROTTLE_SECONDS = 3600;

/**
 * J-ops.dead: turns a job that failed its last attempt into a `job_failed` ops alert, throttled to
 * one per source queue per hour. The source comes from the dead letter's metadata; the payload, a
 * copy of the failed job's, is never read, parsed or logged.
 */
export const opsDeadJob: JobDefinition<'ops.dead'> = {
  name: 'ops.dead',
  queue: QUEUE_OPTIONS['ops.dead'].queue,
  work: QUEUE_OPTIONS['ops.dead'].work,
  async handle(_payload, ctx) {
    // Without source fields an operator still hears of the failure.
    const source = ctx.job.deadLetter ?? {
      queue: 'unknown',
      jobId: ctx.job.id,
      errorClass: 'Error',
    };
    ctx.log.error('job.dead', {
      sourceQueue: source.queue,
      sourceJobId: source.jobId,
      errorClass: source.errorClass,
    });
    // A null id is a throttled send: this queue already alerted within the hour.
    await ctx.enqueue(
      'ops.alert',
      {
        kind: 'job_failed',
        values: { queue: source.queue, jobId: source.jobId, errorClass: source.errorClass },
      },
      { throttle: { seconds: JOB_FAILED_THROTTLE_SECONDS, key: `job_failed:${source.queue}` } },
    );
  },
};
