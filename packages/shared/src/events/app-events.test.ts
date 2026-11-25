import { describe, expect, it } from 'vitest';
import { APP_EVENT_NAMES, APP_EVENT_PROPS, NUDGE_IDS } from './app-events.ts';

describe('app events', () => {
  it('three event names', () => {
    expect(APP_EVENT_NAMES.options).toEqual([
      'account_created',
      'onboarding_step',
      'onboarding_done',
    ]);
    expect(Object.keys(APP_EVENT_PROPS).sort()).toEqual([...APP_EVENT_NAMES.options].sort());
    expect(APP_EVENT_NAMES.safeParse('run_tap').success).toBe(false);
  });

  it('props are strict', () => {
    expect(APP_EVENT_PROPS.account_created.safeParse({ method: 'apple' }).success).toBe(true);
    expect(
      APP_EVENT_PROPS.account_created.safeParse({ method: 'apple', email: 'a@example.test' })
        .success,
    ).toBe(false);
    expect(APP_EVENT_PROPS.account_created.safeParse({ method: 'password' }).success).toBe(false);
    expect(
      APP_EVENT_PROPS.onboarding_step.safeParse({ step: 'done', outcome: 'completed' }).success,
    ).toBe(true);
    expect(
      APP_EVENT_PROPS.onboarding_step.safeParse({ step: 'photo', outcome: 'abandoned' }).success,
    ).toBe(false);
    expect(APP_EVENT_PROPS.onboarding_done.safeParse({}).success).toBe(true);
    expect(APP_EVENT_PROPS.onboarding_done.safeParse({ step: 'done' }).success).toBe(false);
  });

  it('seven nudge ids', () => {
    expect([...NUDGE_IDS]).toEqual([
      'after_run',
      'after_follow_office',
      'messages_inbox',
      'after_post',
      'activity_empty',
      'public_page',
      'right_rail',
    ]);
  });
});
