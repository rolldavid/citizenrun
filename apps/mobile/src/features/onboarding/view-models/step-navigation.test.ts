import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { markNavigationReady, resetNavigationState, trackCurrentPath } from '@/lib/navigation';
import { fixtureMe } from '@/lib/view-models/__fixtures__/common';
import { resetRouterMock, routerCalls } from '@/test/router-mock';

import { goToNextStep } from './step-navigation';

vi.mock('expo-router', async () => (await import('@/test/router-mock')).routerModule);
vi.mock('expo-constants', () => ({
  default: { expoConfig: { extra: { variant: 'development' } } },
}));

beforeEach(() => {
  markNavigationReady();
});

afterEach(() => {
  resetRouterMock();
  resetNavigationState();
});

describe('goToNextStep', () => {
  it('pushes the step Me names', () => {
    trackCurrentPath('/onboarding/photo');
    goToNextStep(fixtureMe({ onboardingStep: 'handle' }));
    expect(routerCalls).toEqual([{ op: 'push', path: '/onboarding/handle' }]);
  });

  it('leaves done to the guard', () => {
    trackCurrentPath('/onboarding/location');
    goToNextStep(fixtureMe({ onboardingStep: 'done' }));
    expect(routerCalls).toEqual([]);
  });

  it('does not push the step already shown', () => {
    trackCurrentPath('/onboarding/issues');
    goToNextStep(fixtureMe({ onboardingStep: 'issues' }));
    expect(routerCalls).toEqual([]);
  });

  it('moves forward to a later step after a step was saved again', () => {
    trackCurrentPath('/onboarding/photo');
    goToNextStep(fixtureMe({ onboardingStep: 'issues' }));
    expect(routerCalls).toEqual([{ op: 'push', path: '/onboarding/issues' }]);
  });
});
