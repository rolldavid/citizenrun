import type { Href } from '@/lib/view-models/common.types';

/** SCR-welcome. */
export type WelcomeViewModel = { startHref: Href; links: { terms: string; privacyPolicy: string } };
