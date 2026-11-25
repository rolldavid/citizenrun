import { users } from '@citizenrun/db';
import { BRAND, createI18n } from '@citizenrun/shared';
import type { JobPayload } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import type { JobContext } from '../../context.ts';
import { renderEmail, toEmailMessage } from '../../lib/email/render.ts';
import type { EmailContacts, NotificationsT } from '../../lib/email/render.ts';
import { QUEUE_OPTIONS } from '../../queue-options.ts';
import { PermanentJobError, errorClassOf } from '../types.ts';
import type { JobDefinition } from '../types.ts';
import { countUserEmail } from './email-cap.ts';

type SigninMethodAdded = Extract<JobPayload<'notify.email'>, { template: 'signin_method_added' }>;

/** Why an email was not sent; logged as `email.skipped`. */
type SkipReason = 'no_user' | 'no_address' | 'email_status' | 'not_active';

// One instance per process, made on first use: importing this file starts nothing.
let i18n: ReturnType<typeof createI18n> | null = null;

// The notifications text in the recipient's locale; a locale with no catalog falls back to English.
function translatorFor(locale: string): NotificationsT {
  i18n ??= createI18n({ lng: 'en' });
  return i18n.getFixedT(locale);
}

// The brand's public contacts, from the brand module; each is null until the brand file holds it.
function brandContacts(): EmailContacts {
  return {
    supportEmail: BRAND.contacts.supportEmail,
    postalAddress: BRAND.contacts.postalAddress,
  };
}

/** The user an email goes to, or why it is not sent. */
type Recipient = { skip: SkipReason } | { skip: null; userId: string; to: string; locale: string };

// Skips, in order: no row, no address, a bounced or complained address, an account not active.
async function loadRecipient(ctx: JobContext, userId: string): Promise<Recipient> {
  const [user] = await ctx.db
    .select({
      email: users.email,
      emailStatus: users.emailStatus,
      status: users.status,
      locale: users.locale,
    })
    .from(users)
    .where(eq(users.id, userId));
  if (user === undefined) {
    return { skip: 'no_user' };
  }
  if (user.email === null) {
    return { skip: 'no_address' };
  }
  if (user.emailStatus !== 'ok') {
    return { skip: 'email_status' };
  }
  if (user.status !== 'active') {
    return { skip: 'not_active' };
  }
  return { skip: null, userId, to: user.email, locale: user.locale };
}

async function sendSigninMethodAdded(payload: SigninMethodAdded, ctx: JobContext): Promise<void> {
  const { template } = payload;
  const recipient = await loadRecipient(ctx, payload.userId);
  if (recipient.skip !== null) {
    ctx.log.info('email.skipped', { template, reason: recipient.skip });
    return;
  }

  // A security notice: counted in the daily cap, never skipped by it (D-246).
  await countUserEmail(ctx.db, recipient.userId, ctx.now());

  const contacts = brandContacts();
  // The UTC day the job was created, which is the day the method was linked.
  const rendered = renderEmail(
    'signin_method_added',
    {
      provider: payload.provider,
      date: ctx.job.createdOn.toISOString().slice(0, 10),
      locale: recipient.locale,
      contacts,
    },
    translatorFor(recipient.locale),
  );
  try {
    await ctx.mailer.sendEmail(
      toEmailMessage(rendered, { to: recipient.to, jobId: ctx.job.id, contacts }),
    );
  } catch (error) {
    if (error instanceof PermanentJobError) {
      ctx.log.error('email.failed', { template, errorClass: errorClassOf(error) });
      return;
    }
    throw error;
  }
  ctx.log.info('email.sent', { template });
}

/**
 * J-notify.email: sends one user email by template. Skips, logging `email.skipped` with a reason,
 * when the user, the address or an active account is missing or the address bounced. A provider
 * refusal is logged as `email.failed` and completes; an outage throws so the job retries. Never
 * logs the address, the subject or the body.
 */
export const notifyEmail: JobDefinition<'notify.email'> = {
  name: 'notify.email',
  queue: QUEUE_OPTIONS['notify.email'].queue,
  work: QUEUE_OPTIONS['notify.email'].work,
  async handle(payload, ctx) {
    // One template so far, so there is nothing to switch on: a second member of the payload union
    // makes this call fail to compile until the handler switches on `payload.template`.
    return sendSigninMethodAdded(payload, ctx);
  },
};
