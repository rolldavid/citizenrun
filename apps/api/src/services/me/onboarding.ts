import { users } from '@citizenrun/db';
import type { Tx } from '@citizenrun/db';
import type { OnboardingStep } from '@citizenrun/shared';
import { and, eq } from 'drizzle-orm';
import type { Platform } from '../../middleware/session.ts';
import { writeAppEvent } from '../events/app-events.ts';

/** The onboarding steps in order (L-onboarding); the account step is the sign-in that made the row. */
export const ONBOARDING_ORDER = ['photo', 'handle', 'issues', 'location', 'done'] as const;

/** The step after `step`; 'done' after 'location' and after 'done'. */
export function nextOnboardingStep(step: OnboardingStep): OnboardingStep {
  const index = ONBOARDING_ORDER.indexOf(step);
  return ONBOARDING_ORDER[index + 1] ?? 'done';
}

/**
 * Moves the user from `from` to the next step only when `from` is the current step; writes the
 * `onboarding_step` event and, on entering `done`, sets `onboarded_at` and writes `onboarding_done`
 * (L-onboarding, L-app-events). Returns whether it moved; when it did not, nothing is written.
 */
export async function advanceOnboarding(
  tx: Tx,
  input: {
    userId: string;
    from: Exclude<OnboardingStep, 'done'>;
    outcome: 'completed' | 'skipped';
    platform: Platform;
    now: Date;
  },
): Promise<boolean> {
  const next = nextOnboardingStep(input.from);
  // One conditional statement, so two devices cannot move the same step twice.
  const moved = await tx
    .update(users)
    .set(
      next === 'done' ? { onboardingStep: next, onboardedAt: input.now } : { onboardingStep: next },
    )
    .where(and(eq(users.id, input.userId), eq(users.onboardingStep, input.from)))
    .returning({ id: users.id });
  if (moved.length === 0) {
    return false;
  }
  await writeAppEvent(tx, {
    userId: input.userId,
    name: 'onboarding_step',
    props: { step: input.from, outcome: input.outcome },
    platform: input.platform,
  });
  if (next === 'done') {
    await writeAppEvent(tx, {
      userId: input.userId,
      name: 'onboarding_done',
      props: {},
      platform: input.platform,
    });
  }
  return true;
}
