import { createI18n } from '@citizenrun/shared';
import { renderOpsAlert } from '../../lib/email/ops-alert.ts';
import type { TFunction } from '../../lib/email/ops-alert.ts';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import { PermanentJobError } from '../types.ts';
import type { JobDefinition } from '../types.ts';

// One English instance per process, made on first use: importing this file starts nothing.
let translate: TFunction | null = null;

function englishT(): TFunction {
  translate ??= createI18n({ lng: 'en' }).t;
  return translate;
}

/**
 * J-ops.alert: renders one ops alert and sends it in one email to every address of ADMIN_EMAILS,
 * with the job id as the idempotency key and no unsubscribe header or reply-to (operator mail).
 * Logs the kind only, never a recipient, subject or value. Without admin addresses it logs
 * `ops.alert.no_recipient` and completes. A retryable mailer failure is rethrown; a permanent one
 * is logged as `ops.alert.rejected` and the job completes.
 */
export const opsAlertJob: JobDefinition<'ops.alert'> = {
  name: 'ops.alert',
  queue: QUEUE_OPTIONS['ops.alert'].queue,
  work: QUEUE_OPTIONS['ops.alert'].work,
  async handle(payload, ctx) {
    const { subject, text, html } = renderOpsAlert(
      { kind: payload.kind, values: payload.values, env: ctx.env.envLabel },
      englishT(),
    );
    const recipients = ctx.env.ADMIN_EMAILS;
    if (recipients === null) {
      ctx.log.warn('ops.alert.no_recipient', { kind: payload.kind });
      return;
    }
    try {
      await ctx.mailer.sendEmail({
        to: [...recipients],
        subject,
        text,
        html,
        idempotencyKey: `job:${ctx.job.id}`,
      });
    } catch (error) {
      if (error instanceof PermanentJobError) {
        ctx.log.error('ops.alert.rejected', { kind: payload.kind });
        return;
      }
      throw error;
    }
    ctx.log.info('ops.alert.sent', { kind: payload.kind });
  },
};
