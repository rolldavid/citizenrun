import type { TFunction } from 'i18next';

/** The catalogs the sign-in screens read. */
export const AUTH_NAMESPACES = ['auth', 'common', 'errors', 'onboarding'] as const;

/** The translate function of a component that reads those catalogs. */
export type AuthT = TFunction<typeof AUTH_NAMESPACES>;
