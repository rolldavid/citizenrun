/** A test id a composite component derives from `base`: `<base>-<value>` or `<base>-<part>`. */
export type Derived<A extends string> = { readonly base: string; readonly id: (arg: A) => string };

/** Registers the ids a composite component derives from the `testID` it is given. */
export function derived<A extends string>(base: string, id: (arg: A) => string): Derived<A> {
  return { base, id };
}

/** Every `testID` the journeys and the phone flows find an element by, grouped by feature. */
export const SELECTORS = {
  auth: {
    welcome: 'auth.welcome',
    welcomeStart: 'auth.welcome-start',
    welcomeTerms: 'auth.welcome-terms',
    welcomePrivacy: 'auth.welcome-privacy',
    signIn: 'auth.sign-in',
    appleButton: 'auth.apple-button',
    googleButton: 'auth.google-button',
    emailOption: 'auth.email-option',
    emailField: 'auth.email-field',
    emailContinue: 'auth.email-continue',
    codeField: 'auth.code-field',
    codeVerify: 'auth.code-verify',
    // Its words change with the clock.
    codeResend: 'auth.code-resend-live',
    codeChangeEmail: 'auth.code-change-email',
    stateSelect: 'auth.state-select',
    // A row of the list a wide window opens, then of the sheet a phone opens.
    stateOption: derived('auth.state-select', (code: string) => `auth.state-select-${code}`),
    stateOptionCompact: derived(
      'auth.state-select',
      (code: string) => `auth.state-select-options-${code}`,
    ),
    stateContinue: 'auth.state-continue',
    agreeTerms: 'auth.agree-terms',
    agreePolicy: 'auth.agree-policy',
    agreePrivacy: 'auth.agree-privacy',
    aiNotNow: 'auth.ai-not-now',
    reauthSheet: 'auth.reauth-sheet',
    reauthEmail: 'auth.reauth-email',
    addEmailSheet: 'auth.add-email-sheet',
  },
  onboarding: {
    // The first step of sign-up is drawn by the sign-in screen.
    ageMonth: 'onboarding.age-month',
    ageMonthOption: derived(
      'onboarding.age-month',
      (month: string) => `onboarding.age-month-${month}`,
    ),
    ageMonthOptionCompact: derived(
      'onboarding.age-month',
      (month: string) => `onboarding.age-month-options-${month}`,
    ),
    ageYear: 'onboarding.age-year',
    ageYearOption: derived('onboarding.age-year', (year: string) => `onboarding.age-year-${year}`),
    ageYearOptionCompact: derived(
      'onboarding.age-year',
      (year: string) => `onboarding.age-year-options-${year}`,
    ),
    ageContinue: 'onboarding.age-continue',
    termsAgree: 'onboarding.terms-agree',
    aiConsentAgree: 'onboarding.ai-consent-agree',
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
  system: {
    adultsOnly: 'system.adults-only',
    adultsOnlyClose: 'system.adults-only-close',
    stateUnavailable: 'system.state-unavailable',
    stateUnavailableBrowse: 'system.state-unavailable-browse',
    stateUnavailableDelete: 'system.state-unavailable-delete',
  },
} as const;
