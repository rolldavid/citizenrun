import type { EmailParts, EmailTemplateData, NotificationsT } from './render.ts';

// i18next escapes nothing: the text body is plain text and the layout escapes the HTML once. Spread
// into each call's options, so the catalog check reads only the interpolated values.
const PLAIN_TEXT = { interpolation: { escapeValue: false } } as const;

/**
 * The confirmation sent when an account has been deleted (D-351): what was deleted, what is kept,
 * and the address line while the postal address is known.
 */
export function accountDeletedParts(
  data: EmailTemplateData['account_deleted'],
  t: NotificationsT,
): EmailParts {
  const { postalAddress } = data.contacts;
  return {
    subject: t('notifications:emailAccountDeleted.subject', PLAIN_TEXT),
    paragraphs: [
      t('notifications:emailAccountDeleted.body', PLAIN_TEXT),
      t('notifications:emailAccountDeleted.retained', PLAIN_TEXT),
    ],
    footer:
      postalAddress === null
        ? null
        : t('notifications:email.footerAddress', {
            postalAddress,
            ...PLAIN_TEXT,
          }),
  };
}
