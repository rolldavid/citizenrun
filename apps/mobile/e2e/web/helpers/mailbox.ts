import { expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { z } from 'zod';

/** The dev mailbox (E-AUTH-11); only the seeded stack serves it. */
const MAILBOX_PATH = '/v1/dev/mailbox';
const MAX_TRIES = 20;
/** Long enough for twenty tries at expect.poll's default intervals. */
const POLL_TIMEOUT_MS = 30_000;
const FOUND = 'found';
const GAVE_UP = 'gave up';

const MailboxSchema = z.object({ code: z.string().regex(/^[0-9]{6}$/) });

/**
 * The newest sign-in code sent to `email`, read from the API's capture mailer. Asks at most twenty
 * times; neither the address nor the code is ever printed.
 */
export async function readCode(request: APIRequestContext, email: string): Promise<string> {
  // Held in an object: the poll's callback fills it in.
  const found: { code: string | null } = { code: null };
  let tries = 0;
  await expect
    .poll(
      async () => {
        if (found.code !== null) {
          return FOUND;
        }
        if (tries >= MAX_TRIES) {
          return GAVE_UP;
        }
        tries += 1;
        const response = await request.post(MAILBOX_PATH, { data: { to: email } });
        if (response.status() !== 200) {
          return `status ${String(response.status())}`;
        }
        const parsed = MailboxSchema.safeParse(await response.json());
        if (!parsed.success) {
          return 'no code in the answer';
        }
        found.code = parsed.data.code;
        return FOUND;
      },
      { message: 'a sign-in code reached the dev mailbox', timeout: POLL_TIMEOUT_MS },
    )
    .toBe(FOUND);
  if (found.code === null) {
    throw new Error('No sign-in code reached the dev mailbox');
  }
  return found.code;
}
