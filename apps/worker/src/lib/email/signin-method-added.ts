import { assertNever, formatDate } from '@citizenrun/shared';
import type { EmailParts, EmailTemplateData, NotificationsT } from './render.ts';

type Data = EmailTemplateData['signin_method_added'];

// i18next escapes nothing: the text body is plain text and the layout escapes the HTML once. Spread
// into each call's options, so the catalog check reads only the interpolated values.
const PLAIN_TEXT = { interpolation: { escapeValue: false } } as const;

function providerSentence(data: Data, t: NotificationsT): string {
  const date = formatDate(data.date, data.locale, 'long');
  switch (data.provider) {
    case 'apple':
      return t('notifications:emailSigninMethod.bodyApple', {
        date,
        ...PLAIN_TEXT,
      });
    case 'google':
      return t('notifications:emailSigninMethod.bodyGoogle', {
        date,
        ...PLAIN_TEXT,
      });
    case 'email':
      return t('notifications:emailSigninMethod.bodyEmail', {
        date,
        ...PLAIN_TEXT,
      });
    default:
      return assertNever(data.provider);
  }
}

/**
 * The security notice sent when a sign-in method is linked to an account (D-245): the provider's
 * sentence with the date, the support sentence while the support address is known, and the
 * address line while the postal address is known.
 */
export function signinMethodAddedParts(data: Data, t: NotificationsT): EmailParts {
  const { supportEmail, postalAddress } = data.contacts;
  const paragraphs = [providerSentence(data, t)];
  if (supportEmail !== null) {
    paragraphs.push(
      t('notifications:emailSigninMethod.notYou', {
        supportEmail,
        ...PLAIN_TEXT,
      }),
    );
  }
  return {
    subject: t('notifications:emailSigninMethod.subject', PLAIN_TEXT),
    paragraphs,
    footer:
      postalAddress === null
        ? null
        : t('notifications:email.footerAddress', {
            postalAddress,
            ...PLAIN_TEXT,
          }),
  };
}
