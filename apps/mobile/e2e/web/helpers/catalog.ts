import { RESOURCES, createI18n } from '@citizenrun/shared';

/** The English catalogs: every string a journey compares comes from them, so a copy edit never breaks one. */
const i18n = createI18n();

/** Looks a key up in the English catalogs, with `{{appName}}` and any other values filled in. */
export const t = i18n.t.bind(i18n);

export const { auth, onboarding, settings } = RESOURCES.en;
