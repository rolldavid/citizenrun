import { ApiError } from '@citizenrun/shared';
import type { EmailMessage, Mailer } from '@citizenrun/shared';
import { CAPTURE_KEEP, createCaptureStore } from '../../lib/mailer.ts';
import type { CapturedEmail } from '../../lib/mailer.ts';

const SIX_DIGIT_CODE = /\b\d{6}\b/;

/**
 * The API's mailer fake (TEST-fake-mailer): holds the newest 50 messages, de-duplicated by
 * idempotency key as the capture mailer is, and can be told to fail the next send. `createTestApp`
 * registers `mailTexts()` with the always-on privacy scan (D-855); the fake itself imports nothing
 * of the database harness, so unit tests can use it.
 */
export class CaptureMailer implements Mailer {
  readonly #store = createCaptureStore(CAPTURE_KEEP);
  #failNext: '5xx' | '429' | null = null;

  /** Every message held, oldest first. */
  get sent(): CapturedEmail[] {
    return this.#store.list;
  }

  sendEmail(message: EmailMessage): Promise<void> {
    if (this.#failNext !== null) {
      this.#failNext = null;
      // The Resend mailer answers a provider 5xx and a 429 alike.
      return Promise.reject(new ApiError('unavailable'));
    }
    this.#store.add(message);
    return Promise.resolve();
  }

  /** The messages held, oldest first, at most 50: what E-AUTH-11 reads (L-send-email). */
  captured(): readonly CapturedEmail[] {
    return [...this.#store.list];
  }

  /** The subject, text and HTML of every message held, oldest first: what the privacy scan reads. */
  mailTexts(): string[] {
    return this.#store.list.flatMap((message) => [message.subject, message.text, message.html]);
  }

  /** The last message held for `to`, or null. */
  last(to: string): CapturedEmail | null {
    const address = to.toLowerCase();
    for (let index = this.#store.list.length - 1; index >= 0; index -= 1) {
      const message = this.#store.list[index];
      if (message?.to.some((recipient) => recipient.toLowerCase() === address) === true) {
        return message;
      }
    }
    return null;
  }

  /** The first six-digit code in the text of the last message to `to`, or null. */
  codeFor(to: string): string | null {
    const message = this.last(to);
    if (message === null) {
      return null;
    }
    return SIX_DIGIT_CODE.exec(message.text)?.[0] ?? null;
  }

  /** Makes the next send throw ApiError `unavailable`, as a provider 5xx or 429 does. */
  failNext(kind: '5xx' | '429'): void {
    this.#failNext = kind;
  }
}
