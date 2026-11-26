import { users } from '@citizenrun/db';
import type { Db } from '@citizenrun/db';
import { ApiError, OnboardingStepSchema } from '@citizenrun/shared';
import { eq } from 'drizzle-orm';
import type { Platform } from '../../middleware/session.ts';
import { ONBOARDING_ORDER, advanceOnboarding } from './onboarding.ts';

/**
 * E-ME-10 (L-onboarding): skips `step` when it is the current step; a step already passed changes
 * nothing; a step not reached yet answers `onboarding_step_mismatch`. The location step can only be
 * skipped for now, and skipping it finishes onboarding.
 */
export async function skipOnboardingStep(
  db: Db,
  input: { userId: string; step: 'photo' | 'location'; now: Date; platform: Platform },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ onboardingStep: users.onboardingStep })
      .from(users)
      .where(eq(users.id, input.userId));
    if (row === undefined) {
      throw new ApiError('unauthenticated');
    }
    const current = OnboardingStepSchema.parse(row.onboardingStep);
    const currentIndex = ONBOARDING_ORDER.indexOf(current);
    const stepIndex = ONBOARDING_ORDER.indexOf(input.step);
    if (stepIndex < currentIndex) {
      return;
    }
    if (stepIndex > currentIndex) {
      throw new ApiError('onboarding_step_mismatch');
    }
    // A false answer means a concurrent request moved the step first: nothing more to do.
    await advanceOnboarding(tx, {
      userId: input.userId,
      from: input.step,
      outcome: 'skipped',
      platform: input.platform,
      now: input.now,
    });
  });
}
