import type { TFunction } from 'i18next';

/** The catalogs the sign-up steps read. */
export const STEP_NAMESPACES = ['onboarding', 'common', 'errors'] as const;

/** The translate function of a component that reads those catalogs. */
export type StepT = TFunction<typeof STEP_NAMESPACES>;
