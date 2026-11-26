import { nextPathOf, publicPageUrl, signInHref } from '@/lib/navigation';

import type { WelcomeViewModel } from './welcome.types';

/** SCR-welcome. The route file passes the `next` parameter. */
export function useWelcomeViewModel(input: { next: string | null }): WelcomeViewModel {
  return {
    startHref: signInHref(nextPathOf(input.next) ?? '/'),
    links: { terms: publicPageUrl('/terms'), privacyPolicy: publicPageUrl('/privacy') },
  };
}
