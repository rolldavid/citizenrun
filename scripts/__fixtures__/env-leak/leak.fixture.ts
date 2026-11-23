import { expect, it } from 'vitest';

it('finds no owner key from the shell', () => {
  expect(process.env.RESEND_API_KEY).toBeUndefined();
  expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
});
