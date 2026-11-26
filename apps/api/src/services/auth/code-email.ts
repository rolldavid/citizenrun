import { EMAIL_CODE_TTL_MS, EMAIL_STYLES, createI18n } from '@citizenrun/shared';
import type { Mailer } from '@citizenrun/shared';
import { escapeHtml } from '../../web/escape.ts';

const MINUTE_MS = 60_000;

// One instance per process, made on the first render: importing this file creates nothing.
let i18n: ReturnType<typeof createI18n> | null = null;

function translatorFor(locale: string): ReturnType<typeof createI18n>['t'] {
  i18n ??= createI18n({ lng: 'en' });
  return i18n.getFixedT(locale);
}

// The value is escaped too: a font stack quotes family names, which would otherwise end the
// attribute. The decoded value is the EMAIL_STYLES member itself.
function style(name: keyof typeof EMAIL_STYLES): string {
  return `style="${escapeHtml(EMAIL_STYLES[name])}"`;
}

/**
 * The sign-in code email (L-email-code): the subject and body of the `auth` catalog in `locale`,
 * and the one email layout with inline EMAIL_STYLES values only. No link, image, footer or
 * unsubscribe line.
 */
export function renderCodeEmail(input: { code: string; locale: string; appName: string }): {
  subject: string;
  text: string;
  html: string;
} {
  const t = translatorFor(input.locale);
  const subject = t('auth:email.code.subject', { appName: input.appName });
  const body = t('auth:email.code.body', {
    code: input.code,
    minutes: EMAIL_CODE_TTL_MS / MINUTE_MS,
  });
  const html =
    `<!doctype html><html lang="${escapeHtml(input.locale)}"><head><meta charset="utf-8">` +
    `<title>${escapeHtml(subject)}</title></head>` +
    `<body ${style('body')}><div ${style('container')}>` +
    `<h1 ${style('heading')}>${escapeHtml(subject)}</h1>` +
    `<p ${style('code')}>${escapeHtml(input.code)}</p>` +
    `<p ${style('paragraph')}>${escapeHtml(body)}</p>` +
    '</div></body></html>';
  return { subject, text: body, html };
}

/**
 * Sends the code email through `mailer` with the idempotency key `signin-<challenge id>-<send
 * count>`, no headers and no reply-to (L-email-code). The mailer counts the email itself.
 */
export async function sendCodeEmail(
  mailer: Mailer,
  input: {
    to: string;
    code: string;
    locale: string;
    appName: string;
    challengeId: string;
    sendCount: number;
  },
): Promise<void> {
  const { subject, text, html } = renderCodeEmail(input);
  await mailer.sendEmail({
    to: input.to,
    subject,
    text,
    html,
    idempotencyKey: `signin-${input.challengeId}-${String(input.sendCount)}`,
  });
}
