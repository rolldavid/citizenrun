import { assertNever } from '@citizenrun/shared';
import type { EmailMessage } from '@citizenrun/shared';
import { accountDeletedParts } from './account-deleted.ts';
import { renderLayout } from './layout.ts';
import type { RenderedEmail, TFunction } from './ops-alert.ts';
import { signinMethodAddedParts } from './signin-method-added.ts';

/** The translate function a user email is rendered with, for the recipient's locale. */
export type NotificationsT = TFunction;

/** The brand's public contacts; null while the owner has not given one. */
export type EmailContacts = { supportEmail: string | null; postalAddress: string | null };

/** What each user email template is rendered from. `date` is a YYYY-MM-DD calendar date. */
export type EmailTemplateData = {
  signin_method_added: {
    provider: 'email' | 'apple' | 'google';
    date: string;
    locale: string;
    contacts: EmailContacts;
  };
  account_deleted: { locale: string; contacts: EmailContacts };
};

export type EmailTemplate = keyof EmailTemplateData;

/** A user email's text before layout: its subject, its paragraphs and the footer line, or null. */
export type EmailParts = { subject: string; paragraphs: readonly string[]; footer: string | null };

function partsOf<T extends EmailTemplate>(
  template: T,
  data: EmailTemplateData[T],
  t: NotificationsT,
): EmailParts {
  const name: EmailTemplate = template;
  switch (name) {
    case 'signin_method_added':
      return signinMethodAddedParts(data as EmailTemplateData['signin_method_added'], t); // T is this member here
    case 'account_deleted':
      // Every template's data holds the locale and the contacts, all this one reads.
      return accountDeletedParts(data, t);
    default:
      return assertNever(name);
  }
}

/**
 * One user email in the recipient's language: the subject, a plain-text body (the subject, then
 * each paragraph and the footer line, separated by blank lines) and the HTML of the one layout,
 * which escapes every text once. No unsubscribe header or link (CTL-79).
 */
export function renderEmail<T extends EmailTemplate>(
  template: T,
  data: EmailTemplateData[T],
  t: NotificationsT,
): RenderedEmail {
  const { subject, paragraphs, footer } = partsOf(template, data, t);
  const text = `${[subject, ...paragraphs, ...(footer === null ? [] : [footer])].join('\n\n')}\n`;
  const html = renderLayout({
    title: subject,
    heading: subject,
    paragraphs,
    footer,
    lang: data.locale,
  });
  return { subject, text, html };
}

/**
 * The message for `sendEmail`: the job id as the idempotency key (D-246) and the support address
 * as the reply address, left out while it is not known.
 */
export function toEmailMessage(
  rendered: RenderedEmail,
  args: { to: string; jobId: string; contacts: EmailContacts },
): EmailMessage {
  const { supportEmail } = args.contacts;
  return {
    to: args.to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    idempotencyKey: `job:${args.jobId}`,
    ...(supportEmail === null ? {} : { replyTo: supportEmail }),
  };
}
