/** A test id a composite component derives from `base`: `<base>-<value>` or `<base>-<part>`. */
export type Derived<A extends string> = { readonly base: string; readonly id: (arg: A) => string };

/** Registers the ids a composite component derives from the `testID` it is given. */
export function derived<A extends string>(base: string, id: (arg: A) => string): Derived<A> {
  return { base, id };
}

/** Every `testID` the journeys and the phone flows find an element by, grouped by feature. */
export const SELECTORS = {
  onboarding: {
    photo: 'onboarding.photo',
    photoChoose: 'onboarding.photo-choose',
    photoSkip: 'onboarding.photo-skip',
    photoContinue: 'onboarding.photo-continue',
    photoRetry: 'onboarding.photo-retry',
    photoSettings: 'onboarding.photo-settings',
    handle: 'onboarding.handle',
    handleField: 'onboarding.handle-field',
    // The field is described by its status line, which has no element of its own.
    handleStatus: 'onboarding.handle-field',
    handleContinue: 'onboarding.handle-continue',
    issues: 'onboarding.issues',
    issue: derived('onboarding.issue', (issueId: string) => `onboarding.issue-${issueId}`),
    issueStar: derived('onboarding.issue', (issueId: string) => `onboarding.issue-${issueId}-star`),
    issuesContinue: 'onboarding.issues-continue',
    issuesPart: derived('onboarding.issues', (part: 'retry') => `onboarding.issues-${part}`),
    location: 'onboarding.location',
    locationSkip: 'onboarding.location-skip',
  },
} as const;
