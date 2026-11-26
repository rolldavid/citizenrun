import { EMAIL_STYLES } from '@citizenrun/shared';
import type { EmailMessage, Mailer } from '@citizenrun/shared';
import { describe, expect, it } from 'vitest';
import { renderCodeEmail, sendCodeEmail } from './code-email.ts';

const FIXTURE_APP = 'Fixture App';
const CODE = '042917';

// The five entities escapeHtml writes, decoded, so an attribute reads as the value it carries.
function decode(text: string): string {
  return text
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function styleValues(html: string): string[] {
  return [...html.matchAll(/style="([^"]*)"/g)].map((match) => decode(match[1] ?? ''));
}

function recordingMailer(): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    sendEmail: (message) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
}

describe('renderCodeEmail', () => {
  it('the subject names the app', () => {
    const email = renderCodeEmail({ code: CODE, locale: 'en', appName: FIXTURE_APP });
    expect(email.subject).toBe('Your Fixture App sign-in code');
    expect(email.html).toContain('<title>Your Fixture App sign-in code</title>');
  });

  it('the body holds the code and ten minutes', () => {
    const email = renderCodeEmail({ code: CODE, locale: 'en', appName: FIXTURE_APP });
    expect(email.text).toBe(
      `Your sign-in code is ${CODE}. It expires in 10 minutes. If you did not ask for this code, you can ignore this email.`,
    );
    expect(email.html).toContain(`>${CODE}</p>`);
    expect(email.html).toContain(`<p style="${EMAIL_STYLES.paragraph}">${email.text}</p>`);
  });

  it('the html escapes every value', () => {
    const email = renderCodeEmail({ code: CODE, locale: 'en', appName: '<b>&' });
    expect(email.subject).toBe('Your <b>& sign-in code');
    expect(email.html).toContain('Your &lt;b&gt;&amp; sign-in code');
    expect(email.html).not.toContain('<b>');
    const quoted = renderCodeEmail({ code: CODE, locale: 'en"><x', appName: FIXTURE_APP });
    expect(quoted.html).toContain('<html lang="en&quot;&gt;&lt;x">');
  });

  it('the html uses only EMAIL_STYLES values', () => {
    const email = renderCodeEmail({ code: CODE, locale: 'en', appName: FIXTURE_APP });
    const allowed: readonly string[] = Object.values(EMAIL_STYLES);
    const values = styleValues(email.html);
    expect(values).toEqual([
      EMAIL_STYLES.body,
      EMAIL_STYLES.container,
      EMAIL_STYLES.heading,
      EMAIL_STYLES.code,
      EMAIL_STYLES.paragraph,
    ]);
    for (const value of values) {
      expect(allowed).toContain(value);
    }
    expect(email.html).not.toMatch(/<style|class=/);
  });

  it('no link and no unsubscribe header', async () => {
    const email = renderCodeEmail({ code: CODE, locale: 'en', appName: FIXTURE_APP });
    expect(email.html).not.toContain('<a');
    expect(email.html).not.toContain('href');
    expect(email.html).not.toContain('<img');
    expect(email.text.toLowerCase()).not.toContain('unsubscribe');
    const mailer = recordingMailer();
    await sendCodeEmail(mailer, {
      to: 'person@example.test',
      code: CODE,
      locale: 'en',
      appName: FIXTURE_APP,
      challengeId: 'challenge-fixture',
      sendCount: 1,
    });
    const [message] = mailer.sent;
    expect(message).toBeDefined();
    expect(message?.headers).toBeUndefined();
    expect(message?.replyTo).toBeUndefined();
    expect(message !== undefined && 'headers' in message).toBe(false);
  });

  it('the idempotency key is signin-<id>-<count>', async () => {
    const mailer = recordingMailer();
    for (const sendCount of [1, 2]) {
      await sendCodeEmail(mailer, {
        to: 'person@example.test',
        code: CODE,
        locale: 'en',
        appName: FIXTURE_APP,
        challengeId: '0195d2c4-7a1e-7c3b-9f00-1b2c3d4e5f60',
        sendCount,
      });
    }
    expect(mailer.sent.map((message) => message.idempotencyKey)).toEqual([
      'signin-0195d2c4-7a1e-7c3b-9f00-1b2c3d4e5f60-1',
      'signin-0195d2c4-7a1e-7c3b-9f00-1b2c3d4e5f60-2',
    ]);
    expect(mailer.sent[0]?.to).toBe('person@example.test');
    expect(mailer.sent[0]?.text).toContain(CODE);
  });
});
