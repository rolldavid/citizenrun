import { z } from 'zod';
import { OnboardingStepSchema } from '../schemas/me.ts';

/** The product events the API writes to the event log (L-app-events, D-470). */
export const APP_EVENT_NAMES = z.enum(['account_created', 'onboarding_step', 'onboarding_done']);

export type AppEventName = z.infer<typeof APP_EVENT_NAMES>;

/** The props of each product event: small scalars only, never text a user typed (L-app-events). */
export const APP_EVENT_PROPS = {
  account_created: z.strictObject({ method: z.enum(['email', 'apple', 'google']) }),
  onboarding_step: z.strictObject({
    step: OnboardingStepSchema,
    outcome: z.enum(['completed', 'skipped']),
  }),
  onboarding_done: z.strictObject({}),
} as const satisfies Record<AppEventName, z.ZodType>;

export type AppEventProps<N extends AppEventName> = z.infer<(typeof APP_EVENT_PROPS)[N]>;

/** The ids of the nudges; the list is closed (L-app-events, D-470, D-530). */
export const NUDGE_IDS = [
  'after_run',
  'after_follow_office',
  'messages_inbox',
  'after_post',
  'activity_empty',
  'public_page',
  'right_rail',
] as const;

export type NudgeId = (typeof NUDGE_IDS)[number];
