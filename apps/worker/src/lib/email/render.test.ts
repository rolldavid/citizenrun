import { BRAND, EMAIL_STYLES, createI18n } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape.ts';
import { renderEmail, toEmailMessage } from './render.ts';
import type { EmailContacts } from './render.ts';

const t = createI18n({ lng: 'en' }).t;

const FIXTURE_CONTACTS: EmailContacts = {
  supportEmail: 'support@example.test',
  postalAddress: 'Fixture Address, Fixture City, ZZ 00000',
};
const NO_CONTACTS: EmailContacts = { supportEmail: null, postalAddress: null };
const JOB_ID = '0195d2c4-7a10-7c3e-9a51-2f4c8b6d1e07';

const ADDRESS_LINE = `${BRAND.displayName}, Fixture Address, Fixture City, ZZ 00000`;
const NOT_YOU = "If this wasn't you, email support@example.test right away.";

function signin(
  provider: 'email' | 'apple' | 'google',
  contacts: EmailContacts = NO_CONTACTS,
  locale = 'en',
): ReturnType<typeof renderEmail> {
  return renderEmail('signin_method_added', { provider, date: '2027-03-05', locale, contacts }, t);
}

function deleted(contacts: EmailContacts = NO_CONTACTS): ReturnType<typeof renderEmail> {
  return renderEmail('account_deleted', { locale: 'en', contacts }, t);
}

describe('user emails', () => {
  it('renders the sign-in method notice for each provider', () => {
    const sentences = {
      apple: 'Sign in with Apple was added to your account on March 5, 2027.',
      google: 'Sign in with Google was added to your account on March 5, 2027.',
      email: 'Sign-in with an email code was added to your account on March 5, 2027.',
    } as const;
    for (const provider of ['apple', 'google', 'email'] as const) {
      const email = signin(provider, FIXTURE_CONTACTS);
      expect(email.subject).toBe(`A sign-in method was added to your ${BRAND.displayName} account`);
      expect(email.text).toContain(sentences[provider]);
      expect(email.html).toContain(escapeHtml(sentences[provider]));
      for (const other of Object.values(sentences).filter((s) => s !== sentences[provider])) {
        expect(email.text).not.toContain(other);
      }
      for (const part of [email.subject, email.text, email.html]) {
        expect(part).not.toContain('emailSigninMethod.');
        expect(part).not.toContain('email.footerAddress');
        expect(part).not.toContain('{{');
      }
    }
  });

  it('leaves out the support sentence and the reply address while the support email is not known', () => {
    const without = signin('google', NO_CONTACTS);
    expect(without.text).not.toContain("If this wasn't you");
    expect(without.html).not.toContain('If this wasn&#39;t you');
    const bare = toEmailMessage(without, {
      to: 'user@example.test',
      jobId: JOB_ID,
      contacts: NO_CONTACTS,
    });
    expect('replyTo' in bare).toBe(false);

    const withContacts = signin('google', FIXTURE_CONTACTS);
    expect(withContacts.text).toContain(NOT_YOU);
    expect(withContacts.html).toContain(escapeHtml(NOT_YOU));
    const replying = toEmailMessage(withContacts, {
      to: 'user@example.test',
      jobId: JOB_ID,
      contacts: FIXTURE_CONTACTS,
    });
    expect(replying.replyTo).toBe('support@example.test');
    expect(replying.to).toBe('user@example.test');
    expect(replying.idempotencyKey).toBe(`job:${JOB_ID}`);
  });

  it('leaves out the address line while the postal address is not known', () => {
    for (const email of [signin('apple'), deleted()]) {
      expect(email.html).not.toContain('<hr');
      expect(email.html).not.toContain(`style="${escapeHtml(EMAIL_STYLES.footer)}"`);
      expect(email.text).not.toContain('Fixture Address');
    }
    for (const email of [signin('apple', FIXTURE_CONTACTS), deleted(FIXTURE_CONTACTS)]) {
      expect(email.html).toContain('<hr');
      expect(email.html).toContain(
        `<p style="${escapeHtml(EMAIL_STYLES.footer)}">${escapeHtml(ADDRESS_LINE)}</p>`,
      );
      expect(email.text).toContain(ADDRESS_LINE);
    }
    // Only the postal address decides the footer.
    const supportOnly = signin('apple', {
      supportEmail: 'support@example.test',
      postalAddress: null,
    });
    expect(supportOnly.html).not.toContain('<hr');
  });

  it('renders the deletion confirmation', () => {
    const email = deleted(FIXTURE_CONTACTS);
    expect(email.subject).toBe(`Your ${BRAND.displayName} account has been deleted`);
    expect(email.text).toContain('Your account, posts, messages and other data have been deleted.');
    expect(email.text).toContain(
      'We keep only what the law or our policy requires: reports you filed with your name removed, moderation records, and material preserved under a legal hold. Backups age out within 27 days.',
    );
    expect(email.text).not.toContain('{{');
    expect(email.text).not.toContain('emailAccountDeleted.');
    expect(email.html).toContain(`<title>${escapeHtml(email.subject)}</title>`);
    // The deletion confirmation names no support address, whatever the contacts hold.
    expect(email.text).not.toContain('support@example.test');
  });

  it('carries no unsubscribe header or link', () => {
    const emails = [signin('email', FIXTURE_CONTACTS), deleted(FIXTURE_CONTACTS)];
    for (const email of emails) {
      const message = toEmailMessage(email, {
        to: 'user@example.test',
        jobId: JOB_ID,
        contacts: FIXTURE_CONTACTS,
      });
      expect('headers' in message).toBe(false);
      expect(message.text.toLowerCase()).not.toContain('unsubscribe');
      expect(message.html.toLowerCase()).not.toContain('unsubscribe');
      expect(message.html).not.toContain('<a ');
      expect(message.html).not.toContain('<img');
    }
  });

  it('escapes text written into the page once', () => {
    const contacts: EmailContacts = { supportEmail: 'a<b@example.test', postalAddress: null };
    const email = signin('apple', contacts);
    expect(email.html).toContain('a&lt;b@example.test');
    expect(email.html).not.toContain('&amp;lt;');
    expect(email.html).not.toContain('a<b@example.test');
    expect(email.text).toContain('a<b@example.test');
    expect(email.text).not.toContain('&lt;');
  });

  it('uses only the email style values', () => {
    const allowed = new Set(Object.values(EMAIL_STYLES).map((value) => escapeHtml(value)));
    for (const email of [signin('google', FIXTURE_CONTACTS), deleted(FIXTURE_CONTACTS)]) {
      const styles = [...email.html.matchAll(/style="([^"]*)"/g)].map((match) => match[1]);
      expect(styles.length).toBeGreaterThan(0);
      for (const value of styles) {
        expect(allowed.has(value ?? '')).toBe(true);
      }
    }
  });

  it("writes the recipient's language", () => {
    expect(signin('apple', NO_CONTACTS, 'en-US').html).toContain('<html lang="en-US">');
    expect(signin('apple', NO_CONTACTS, 'en').html).toContain('<html lang="en">');
    expect(
      renderEmail('account_deleted', { locale: 'en-US', contacts: NO_CONTACTS }, t).html,
    ).toContain('<html lang="en-US">');
  });

  it('ends the text with the footer only when there is one', () => {
    expect(signin('apple', FIXTURE_CONTACTS).text.endsWith(`\n\n${ADDRESS_LINE}\n`)).toBe(true);
    expect(deleted(FIXTURE_CONTACTS).text.endsWith(`\n\n${ADDRESS_LINE}\n`)).toBe(true);

    const bare = signin('apple', NO_CONTACTS);
    expect(bare.text).toBe(
      `A sign-in method was added to your ${BRAND.displayName} account\n\n` +
        'Sign in with Apple was added to your account on March 5, 2027.\n',
    );
    expect(deleted(NO_CONTACTS).text.endsWith('Backups age out within 27 days.\n')).toBe(true);
  });
});
